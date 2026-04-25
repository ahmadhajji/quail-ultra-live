"""OpenAI extraction provider adapter."""

from __future__ import annotations

import base64
import json
import mimetypes
import time
from pathlib import Path
from typing import Any

from openai import OpenAI

from domain.models import ExtractedQuestion
from ai.prompts import FAST_QUESTION_EXTRACTION_PROMPT, IMAGE_ANALYSIS_PROMPT, QUESTION_EXTRACTION_PROMPT
from utils.question_hardening import (
    classify_extracted_question,
    normalized_stem,
    sanitize_choice_map,
    strip_bat_markers,
)

try:
    from stats.collector import get_stats_collector
except Exception:  # pragma: no cover - optional stats module

    def get_stats_collector() -> Any:  # type: ignore[misc]
        return None


VALID_PROMPT_MODES = {"standard", "fast"}

OPENAI_EXTRACTION_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["slide_has_questions", "question_count", "questions"],
    "properties": {
        "slide_has_questions": {"type": "boolean"},
        "question_count": {"type": "integer"},
        "questions": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "question_number",
                    "variant_label",
                    "is_valid_question",
                    "question_stem",
                    "question_image_numbers",
                    "explanation_image_numbers",
                    "choices",
                    "correct_answer",
                    "correct_answer_text",
                    "confidence",
                    "explanation",
                    "flags",
                    "source_of_answer",
                ],
                "properties": {
                    "question_number": {"type": "integer"},
                    "variant_label": {"type": "string"},
                    "is_valid_question": {"type": "boolean"},
                    "question_stem": {"type": "string"},
                    "question_image_numbers": {
                        "type": "array",
                        "items": {"type": "integer"},
                    },
                    "explanation_image_numbers": {
                        "type": "array",
                        "items": {"type": "integer"},
                    },
                    "choices": {
                        "type": "object",
                        "additionalProperties": False,
                        "required": ["A", "B", "C", "D", "E"],
                        "properties": {
                            "A": {"type": "string"},
                            "B": {"type": "string"},
                            "C": {"type": "string"},
                            "D": {"type": "string"},
                            "E": {"type": "string"},
                        },
                    },
                    "correct_answer": {"type": "string", "enum": ["A", "B", "C", "D", "E"]},
                    "correct_answer_text": {"type": "string"},
                    "confidence": {"type": "integer"},
                    "explanation": {"type": "string"},
                    "flags": {"type": "array", "items": {"type": "string"}},
                    "source_of_answer": {"type": "string"},
                },
            },
        },
    },
}


class OpenAIExtractionAdapter:
    """OpenAI adapter for question extraction from text and images."""

    def __init__(
        self,
        api_key: str,
        model_name: str = "gpt-4.1-mini",
        prompt_mode: str = "standard",
        min_request_interval: float = 0.0,
        client: OpenAI | None = None,
    ):
        self.client = client or OpenAI(api_key=api_key)
        self.model_name = model_name or "gpt-4.1-mini"
        if prompt_mode not in VALID_PROMPT_MODES:
            prompt_mode = "standard"
        self.prompt_mode = prompt_mode
        self.last_request_time = 0.0
        self.min_request_interval = max(0.0, float(min_request_interval))

    def _rate_limit(self) -> None:
        elapsed = time.time() - self.last_request_time
        if elapsed < self.min_request_interval:
            time.sleep(self.min_request_interval - elapsed)
        self.last_request_time = time.time()

    def _build_text_prompt(
        self,
        slide_text: str,
        speaker_notes: str,
        comments: str,
        highlighted: str,
    ) -> str:
        template = FAST_QUESTION_EXTRACTION_PROMPT if self.prompt_mode == "fast" else QUESTION_EXTRACTION_PROMPT
        return template.format(
            slide_text=strip_bat_markers(slide_text) or "None",
            speaker_notes=strip_bat_markers(speaker_notes) or "None",
            comments=strip_bat_markers(comments) or "None",
            highlighted=strip_bat_markers(highlighted) or "None",
        )

    def _build_vision_prompt(
        self,
        speaker_notes: str,
        comments: str,
        highlighted: str,
    ) -> str:
        return IMAGE_ANALYSIS_PROMPT.format(
            speaker_notes=strip_bat_markers(speaker_notes) or "None",
            highlighted=strip_bat_markers(highlighted) or "None",
            comments=strip_bat_markers(comments) or "None",
        )

    def _image_to_input_part(self, image_path: Path) -> dict:
        mime_type, _ = mimetypes.guess_type(str(image_path))
        if not mime_type:
            mime_type = "image/png"
        payload = base64.b64encode(image_path.read_bytes()).decode("ascii")
        return {
            "type": "input_image",
            "image_url": f"data:{mime_type};base64,{payload}",
        }

    def _extract_output_text(self, response) -> str:
        output_text = getattr(response, "output_text", "") or ""
        if output_text:
            return output_text
        dump = response.model_dump() if hasattr(response, "model_dump") else {}
        chunks: list[str] = []
        for output_item in dump.get("output", []):
            for content_item in output_item.get("content", []):
                if content_item.get("type") in {"output_text", "text"} and content_item.get("text"):
                    chunks.append(content_item["text"])
        return "".join(chunks)

    @staticmethod
    def build_request_payload(user_content, model_name: str) -> dict:
        return {
            "model": model_name,
            "input": [{"role": "user", "content": user_content}],
            "timeout": 90,
            "text": {
                "format": {
                    "type": "json_schema",
                    "name": "extracted_questions",
                    "schema": OPENAI_EXTRACTION_SCHEMA,
                    "strict": True,
                }
            },
        }

    def _request_json(self, user_content, method: str, slide_number: int, retries: int = 3) -> tuple[dict, str]:
        last_error: Exception | None = None
        for attempt in range(max(1, retries)):
            try:
                self._rate_limit()
                payload = self.build_request_payload(user_content, self.model_name)
                call_start = time.time()
                response = self.client.responses.create(**payload)
                latency_ms = (time.time() - call_start) * 1000.0
                stats = get_stats_collector()
                if stats:
                    stats.record_ai_call(
                        response=response,
                        model=self.model_name,
                        method=method,
                        slide_number=slide_number,
                        latency_ms=latency_ms,
                        success=True,
                    )
                text = self._extract_output_text(response).strip()
                if not text:
                    raise RuntimeError("Empty output_text from OpenAI extraction call")
                return json.loads(text), text
            except Exception as e:
                last_error = e
                stats = get_stats_collector()
                if stats:
                    stats.record_ai_call(
                        response=None,
                        model=self.model_name,
                        method=method,
                        slide_number=slide_number,
                        latency_ms=0,
                        success=False,
                        error=str(e),
                    )
                if attempt < retries - 1:
                    time.sleep((2**attempt) + 0.25)
        raise RuntimeError(str(last_error) if last_error else "OpenAI extraction call failed")

    @staticmethod
    def _normalize_image_numbers(raw_value) -> list[int]:
        if not isinstance(raw_value, list):
            return []
        normalized: list[int] = []
        seen: set[int] = set()
        for value in raw_value:
            try:
                number = int(value)
            except (TypeError, ValueError):
                continue
            if number < 1 or number in seen:
                continue
            seen.add(number)
            normalized.append(number)
        return normalized

    def _classify_image_roles(
        self,
        raw_question: dict,
        images: list[str],
        extraction_method: str,
    ) -> tuple[list[str], list[str]]:
        if not images:
            return [], []

        if extraction_method != "vision":
            return [], images.copy()

        question_numbers = self._normalize_image_numbers(raw_question.get("question_image_numbers"))
        explanation_numbers = self._normalize_image_numbers(raw_question.get("explanation_image_numbers"))
        explanation_number_set = set(explanation_numbers)
        classified_numbers = set(question_numbers) | explanation_number_set

        available = {index: path for index, path in enumerate(images, start=1)}
        question_seen: set[str] = set()
        question_images: list[str] = []
        for number in question_numbers:
            image_path = available.get(number)
            if image_path and image_path not in question_seen:
                question_images.append(image_path)
                question_seen.add(image_path)

        explanation_seen: set[str] = set(question_seen)
        explanation_images: list[str] = []
        for index, image_path in enumerate(images, start=1):
            if image_path in explanation_seen:
                continue
            if index in explanation_number_set or index not in classified_numbers:
                explanation_images.append(image_path)
                explanation_seen.add(image_path)

        return question_images, explanation_images

    def _parse_question_entries(
        self,
        data: dict,
        slide_number: int,
        extraction_method: str,
        images: list[str],
        raw_text: str = "",
    ) -> list[ExtractedQuestion]:
        questions = data.get("questions", [])
        if not isinstance(questions, list):
            questions = []
        has_questions = bool(data.get("slide_has_questions")) and bool(questions)

        if not has_questions:
            question_images, explanation_images = self._classify_image_roles({}, images, extraction_method)
            question = ExtractedQuestion(
                slide_number=slide_number,
                classification="rejected",
                review_status="pending",
                review_reasons=["Model did not detect a valid question on this slide"],
                validation={"model_slide_has_questions": False},
                error="Not detected as question slide",
                images=question_images,
                explanation_images=explanation_images,
                extraction_method=extraction_method,
                raw_model_payload=data,
                raw_model_text=raw_text,
                raw_response=raw_text,
            )
            return [question]

        results: list[ExtractedQuestion] = []
        for idx, raw in enumerate(questions, 1):
            if not isinstance(raw, dict):
                continue
            raw_choices = raw.get("choices", {})
            if not isinstance(raw_choices, dict):
                raw_choices = {}
            cleaned_choices = sanitize_choice_map(raw_choices)

            question_stem = strip_bat_markers(str(raw.get("question_stem", "")).strip())
            correct_answer = str(raw.get("correct_answer", "")).strip()
            model_suggested_valid = bool(raw.get("is_valid_question", True))

            flags = raw.get("flags", [])
            if not isinstance(flags, list):
                flags = []
            question_images, explanation_images = self._classify_image_roles(raw, images, extraction_method)

            question = ExtractedQuestion(
                slide_number=slide_number,
                question_index=idx,
                variant_label=str(raw.get("variant_label", "")).strip(),
                question_stem=question_stem,
                choices=cleaned_choices,
                correct_answer=correct_answer,
                correct_answer_text=strip_bat_markers(str(raw.get("correct_answer_text", "")).strip()),
                confidence=max(0, min(100, int(raw.get("confidence", 0) or 0))),
                explanation=strip_bat_markers(str(raw.get("explanation", "")).strip()),
                flags=[strip_bat_markers(str(x)) for x in flags if strip_bat_markers(str(x))],
                source_of_answer=str(raw.get("source_of_answer", "")).strip(),
                images=question_images,
                explanation_images=explanation_images,
                extraction_method=extraction_method,
                raw_model_payload=raw,
                raw_model_text=raw_text,
                raw_response=raw_text,
            )
            classification, reasons, validation = classify_extracted_question(
                question,
                model_suggested_valid=model_suggested_valid,
            )
            question.classification = classification
            question.review_reasons = reasons
            question.validation = validation
            question.review_status = "approved" if classification == "accepted" else "pending"
            results.append(question)

        if not results:
            question_images, explanation_images = self._classify_image_roles({}, images, extraction_method)
            return [
                ExtractedQuestion(
                    slide_number=slide_number,
                    classification="error",
                    review_status="pending",
                    review_reasons=["Model response contained no parseable question objects"],
                    validation={"model_parse_error": True},
                    error="No parseable question objects in model response",
                    images=question_images,
                    explanation_images=explanation_images,
                    extraction_method=extraction_method,
                    raw_model_payload=data,
                    raw_model_text=raw_text,
                    raw_response=raw_text,
                )
            ]

        return results

    def extract_from_text(
        self,
        slide_number: int,
        slide_text: str,
        speaker_notes: str = "",
        highlighted: str = "",
        comments: str = "",
        images: list[str] | None = None,
    ) -> list[ExtractedQuestion]:
        images = images or []
        prompt = self._build_text_prompt(
            slide_text=slide_text,
            speaker_notes=speaker_notes,
            comments=comments,
            highlighted=highlighted,
        )
        data, raw_text = self._request_json(
            user_content=[{"type": "input_text", "text": prompt}],
            method="text",
            slide_number=slide_number,
        )
        return self._parse_question_entries(
            data=data,
            slide_number=slide_number,
            extraction_method="text",
            images=images,
            raw_text=raw_text,
        )

    def extract_from_image(
        self,
        slide_number: int,
        image_paths: list[str],
        speaker_notes: str = "",
        highlighted: str = "",
        comments: str = "",
        context_image_paths: list[str] | None = None,
    ) -> list[ExtractedQuestion]:
        valid_paths = [Path(p) for p in image_paths if p and Path(p).exists()]
        context_paths = [Path(p) for p in (context_image_paths or []) if p and Path(p).exists()]
        if not valid_paths and not context_paths:
            return [
                ExtractedQuestion(
                    slide_number=slide_number,
                    classification="error",
                    review_status="pending",
                    review_reasons=["No valid images available for visual rescue"],
                    error="No valid images for OCR extraction",
                    extraction_method="vision",
                )
            ]

        valid_paths = valid_paths[:3]
        prompt = self._build_vision_prompt(
            speaker_notes=speaker_notes,
            comments=comments,
            highlighted=highlighted,
        )
        content = [{"type": "input_text", "text": prompt}]
        for image_path in context_paths[:1]:
            content.append(self._image_to_input_part(image_path))
        for image_path in valid_paths:
            content.append(self._image_to_input_part(image_path))

        data, raw_text = self._request_json(
            user_content=content,
            method="vision",
            slide_number=slide_number,
        )
        return self._parse_question_entries(
            data=data,
            slide_number=slide_number,
            extraction_method="vision",
            images=[str(p) for p in valid_paths],
            raw_text=raw_text,
        )

    @staticmethod
    def _mark_disagreement(results: list[ExtractedQuestion], message: str) -> list[ExtractedQuestion]:
        for result in results:
            if message not in result.review_reasons:
                result.review_reasons.append(message)
            if result.classification == "accepted":
                result.classification = "needs_review"
                result.review_status = "pending"
        return results

    @staticmethod
    def _result_signatures(results: list[ExtractedQuestion]) -> set[tuple[str, tuple[tuple[str, str], ...], str]]:
        signatures: set[tuple[str, tuple[tuple[str, str], ...], str]] = set()
        for result in results:
            choices = tuple(sorted(sanitize_choice_map(result.choices).items()))
            signatures.add((normalized_stem(result.question_stem), choices, result.correct_answer))
        return signatures

    def _merge_text_and_visual_results(
        self,
        text_results: list[ExtractedQuestion],
        visual_results: list[ExtractedQuestion],
    ) -> list[ExtractedQuestion]:
        text_accepted = [result for result in text_results if result.classification == "accepted"]
        visual_accepted = [result for result in visual_results if result.classification == "accepted"]

        if text_accepted and visual_accepted:
            if self._result_signatures(text_accepted) != self._result_signatures(visual_accepted):
                return self._mark_disagreement(
                    text_results,
                    "Visual rescue disagreed with text extraction",
                )
            return text_results

        if visual_accepted:
            return self._mark_disagreement(
                visual_results,
                "Accepted only after visual rescue",
            )

        if text_accepted:
            return text_results

        visual_review = [result for result in visual_results if result.classification == "needs_review"]
        text_review = [result for result in text_results if result.classification == "needs_review"]
        if visual_review and not text_review:
            return self._mark_disagreement(
                visual_results,
                "Visual rescue produced a more recoverable result than text extraction",
            )
        return text_results

    def process_slide(
        self,
        slide_number: int,
        slide_text: str,
        speaker_notes: str = "",
        highlighted: str = "",
        comments: str = "",
        images: list[str] | None = None,
        slide_image_path: str = "",
    ) -> list[ExtractedQuestion]:
        images = images or []
        text_results = self.extract_from_text(
            slide_number=slide_number,
            slide_text=slide_text,
            speaker_notes=speaker_notes,
            highlighted=highlighted,
            comments=comments,
            images=images,
        )

        text_accepted = any(result.classification == "accepted" for result in text_results)
        low_text_density = len(strip_bat_markers(slide_text).strip()) < 120
        should_run_rescue = bool(images or slide_image_path) and (low_text_density or not text_accepted)
        if not should_run_rescue:
            return text_results

        visual_results = self.extract_from_image(
            slide_number=slide_number,
            image_paths=images,
            speaker_notes=speaker_notes,
            highlighted=highlighted,
            comments=comments,
            context_image_paths=[slide_image_path] if slide_image_path else [],
        )
        return self._merge_text_and_visual_results(text_results, visual_results)
