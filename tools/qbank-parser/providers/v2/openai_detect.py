"""Stage 2 detection adapter — OpenAI multimodal call per slide.

One AI call per slide. Always sends text + rendered slide screenshot +
speaker notes + filtered comments + highlighted text. The model identifies
question(s) on the slide and returns structured JSON.

No web search, no escalation, no fact-checking. The source is the authority.
"""

from __future__ import annotations

import base64
import json
import logging
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from domain.models import DetectedQuestion, RawSlide

logger = logging.getLogger(__name__)

DETECT_PROMPT_VERSION = "v2-detect-1"

DEFAULT_DETECT_MODEL = "gpt-5.4-mini"
DEFAULT_DETECT_REASONING_EFFORT = "low"

MAX_RETRIES = 3
INITIAL_BACKOFF_SECONDS = 2.0


SYSTEM_PROMPT = """You analyze a single slide from a medical USMLE qbank deck.

The deck is curated by medical students from professor recall sessions and \
exam debriefs. You will receive:
- Text content from the slide
- A rendered screenshot of the slide
- Speaker notes (if any)
- Slide-anchored comments from the deck (if any)
- Highlighted text spans (yellow/green fills) — these are very strong signals \
about which choice is the correct answer

Your job: identify each question on the slide and extract its raw structured \
content. Do NOT rewrite, polish, or expand — that happens later. Preserve the \
source's wording.

Critical rules:
1. A slide may contain 0, 1, 2, or 3 questions. Comparison/table slides often \
have multiple variants ("Q1: if X / Q2: if Y").
2. Highlighted text is the #1 signal for the correct answer when explicit \
markers are absent.
3. Speaker notes and comments are authoritative context — read them.
4. Distinguish images that are part of the question stem (clinical photo, \
ECG, micrograph) from images that are part of the explanation.
5. If the slide is purely a screenshot of a question from another resource \
(NBME/UWorld), use OCR on the screenshot to extract the question.
6. If the slide is not a question (title slide, agenda, references), return \
an empty questions array.

Return strict JSON matching the response schema. No markdown, no commentary."""


RESPONSE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "questions": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "question_index": {"type": "integer", "minimum": 1},
                    "stem_text": {"type": "string"},
                    "choices": {
                        "type": "object",
                        "additionalProperties": {"type": "string"},
                    },
                    "correct_answer": {"type": "string"},
                    "explanation_hint": {"type": "string"},
                    "stem_image_numbers": {
                        "type": "array",
                        "items": {"type": "integer", "minimum": 1},
                    },
                    "explanation_image_numbers": {
                        "type": "array",
                        "items": {"type": "integer", "minimum": 1},
                    },
                    "confidence": {"type": "integer", "minimum": 0, "maximum": 100},
                    "warnings": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                },
                "required": [
                    "question_index",
                    "stem_text",
                    "choices",
                    "correct_answer",
                    "explanation_hint",
                    "stem_image_numbers",
                    "explanation_image_numbers",
                    "confidence",
                    "warnings",
                ],
            },
        },
        "no_question_reason": {"type": "string"},
    },
    "required": ["questions", "no_question_reason"],
}


@dataclass
class DetectionUsage:
    """Per-call OpenAI usage stats."""

    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0


@dataclass
class DetectionResult:
    """Result of detecting questions on a single slide."""

    slide_number: int
    questions: list[DetectedQuestion]
    no_question_reason: str = ""
    usage: DetectionUsage = None  # type: ignore[assignment]
    error: str = ""

    def __post_init__(self):
        if self.usage is None:
            self.usage = DetectionUsage()


class OpenAIDetectAdapter:
    """Stage 2 — multimodal detection of questions on a slide."""

    def __init__(
        self,
        api_key: str,
        model_name: str = DEFAULT_DETECT_MODEL,
        reasoning_effort: str = DEFAULT_DETECT_REASONING_EFFORT,
        client: Any = None,
    ):
        if not api_key:
            raise ValueError("OPENAI_API_KEY is required for v2 detection adapter")
        self.api_key = api_key
        self.model_name = model_name
        self.reasoning_effort = reasoning_effort
        if client is not None:
            self._client = client
        else:
            from openai import OpenAI

            self._client = OpenAI(api_key=api_key)

    def detect(self, slide: RawSlide) -> DetectionResult:
        """Run detection on a single slide. Returns empty questions on slides without questions."""
        user_payload = self._build_user_payload(slide)
        last_error: str | None = None

        for attempt in range(1, MAX_RETRIES + 1):
            try:
                response = self._client.responses.create(
                    model=self.model_name,
                    reasoning={"effort": self.reasoning_effort},
                    input=[
                        {"role": "system", "content": SYSTEM_PROMPT},
                        {"role": "user", "content": user_payload},
                    ],
                    response_format={
                        "type": "json_schema",
                        "json_schema": {
                            "name": "DetectedSlide",
                            "schema": RESPONSE_SCHEMA,
                            "strict": True,
                        },
                    },
                )
                return self._parse_response(slide, response)
            except Exception as exc:  # broad: network/rate-limit/parse all retry
                last_error = str(exc)
                if attempt < MAX_RETRIES:
                    sleep_for = INITIAL_BACKOFF_SECONDS * (2 ** (attempt - 1))
                    logger.warning(
                        "Stage 2 detection failed for slide %s (attempt %s): %s — retrying in %.1fs",
                        slide.slide_number,
                        attempt,
                        last_error,
                        sleep_for,
                    )
                    time.sleep(sleep_for)
                else:
                    logger.error(
                        "Stage 2 detection failed for slide %s after %s attempts: %s",
                        slide.slide_number,
                        MAX_RETRIES,
                        last_error,
                    )

        return DetectionResult(
            slide_number=slide.slide_number,
            questions=[],
            error=last_error or "unknown error",
        )

    def _build_user_payload(self, slide: RawSlide) -> list[dict]:
        """Build multimodal user message: text payload + slide screenshot + per-image attachments."""
        text_section = self._format_text_section(slide)
        payload: list[dict] = [{"type": "input_text", "text": text_section}]

        # Always include the rendered slide screenshot
        if slide.slide_screenshot_path and Path(slide.slide_screenshot_path).exists():
            payload.append(self._image_input(slide.slide_screenshot_path))

        # Each extracted image gets a numbered label so the model can reference
        # `stem_image_numbers` / `explanation_image_numbers`
        for image_path in slide.image_paths:
            if Path(image_path).exists():
                payload.append(self._image_input(image_path))

        return payload

    def _format_text_section(self, slide: RawSlide) -> str:
        lines: list[str] = []
        lines.append(f"SLIDE NUMBER: {slide.slide_number}")
        lines.append(f"DECK ID: {slide.deck_id}")
        lines.append("")
        lines.append("TEXT BLOCKS:")
        if slide.text_blocks:
            for block in slide.text_blocks:
                lines.append(f"- {block}")
        else:
            lines.append("(none)")
        lines.append("")
        lines.append("SPEAKER NOTES:")
        lines.append(slide.speaker_notes.strip() or "(none)")
        lines.append("")
        lines.append("HIGHLIGHTED TEXT (yellow/green fills — strong correct-answer signal):")
        if slide.highlighted_texts:
            for text in slide.highlighted_texts:
                lines.append(f"- {text}")
        else:
            lines.append("(none)")
        lines.append("")
        if slide.potential_correct_answer:
            lines.append(f"POTENTIAL CORRECT ANSWER (from highlights): {slide.potential_correct_answer}")
            lines.append("")
        lines.append("SLIDE-ANCHORED COMMENTS (filtered):")
        if slide.comments:
            for comment in slide.comments:
                author = comment.get("author", "Unknown")
                content = comment.get("content", "")
                if content:
                    lines.append(f"- [{author}] {content}")
        else:
            lines.append("(none)")
        lines.append("")
        lines.append(f"NUMBER OF EXTRACTED IMAGES: {len(slide.image_paths)}")
        lines.append("")
        lines.append(
            "Identify each question on this slide and return strict JSON. "
            "If the slide has no questions, return {\"questions\": [], \"no_question_reason\": \"...\"}."
        )
        return "\n".join(lines)

    @staticmethod
    def _image_input(path: str | Path) -> dict:
        with open(path, "rb") as f:
            data = base64.b64encode(f.read()).decode("ascii")
        return {
            "type": "input_image",
            "image_url": f"data:image/png;base64,{data}",
            "detail": "high",
        }

    def _parse_response(self, slide: RawSlide, response: Any) -> DetectionResult:
        """Parse the OpenAI Responses API output into DetectionResult."""
        # Responses API returns output_text as a convenience accessor.
        raw_text = getattr(response, "output_text", None)
        if not raw_text:
            # Fall back to walking the structured output
            for item in getattr(response, "output", []) or []:
                if getattr(item, "type", "") == "message":
                    for piece in getattr(item, "content", []) or []:
                        text_value = getattr(piece, "text", None)
                        if text_value:
                            raw_text = text_value
                            break
                if raw_text:
                    break

        if not raw_text:
            return DetectionResult(
                slide_number=slide.slide_number,
                questions=[],
                error="empty response from model",
                usage=_extract_usage(response),
            )

        try:
            payload = json.loads(raw_text)
        except json.JSONDecodeError as exc:
            return DetectionResult(
                slide_number=slide.slide_number,
                questions=[],
                error=f"json parse error: {exc}",
                usage=_extract_usage(response),
            )

        return DetectionResult(
            slide_number=slide.slide_number,
            questions=_build_questions(slide, payload, self.model_name),
            no_question_reason=payload.get("no_question_reason", ""),
            usage=_extract_usage(response),
        )


def _build_questions(slide: RawSlide, payload: dict, model_name: str) -> list[DetectedQuestion]:
    """Convert the model's JSON payload into DetectedQuestion instances.

    Resolves stem_image_numbers / explanation_image_numbers (1-based references
    into slide.image_paths) into actual file paths.
    """
    questions: list[DetectedQuestion] = []
    raw_questions = payload.get("questions", []) or []
    for entry in raw_questions:
        index = int(entry.get("question_index", 1) or 1)
        stem_image_paths = _resolve_image_refs(slide, entry.get("stem_image_numbers", []))
        explanation_image_paths = _resolve_image_refs(slide, entry.get("explanation_image_numbers", []))
        confidence = int(entry.get("confidence", 0) or 0)
        warnings = list(entry.get("warnings", []) or [])
        status = "needs_review" if confidence < 70 or warnings else "ok"

        question = DetectedQuestion(
            deck_id=slide.deck_id,
            slide_number=slide.slide_number,
            question_index=index,
            stem_text=str(entry.get("stem_text", "") or "").strip(),
            choices={k: str(v).strip() for k, v in (entry.get("choices") or {}).items()},
            correct_answer=str(entry.get("correct_answer", "") or "").strip().upper(),
            explanation_hint=str(entry.get("explanation_hint", "") or "").strip(),
            stem_image_paths=stem_image_paths,
            explanation_image_paths=explanation_image_paths,
            source_slide_path=slide.slide_screenshot_path,
            speaker_notes=slide.speaker_notes,
            comments=list(slide.comments),
            highlighted_texts=list(slide.highlighted_texts),
            confidence=confidence,
            status=status,
            detection_warnings=warnings,
            detect_model=model_name,
            detect_prompt_version=DETECT_PROMPT_VERSION,
        )
        questions.append(question)
    return questions


def _resolve_image_refs(slide: RawSlide, refs: list) -> list[str]:
    """Map 1-based image indices into slide.image_paths to actual file paths."""
    if not refs:
        return []
    resolved: list[str] = []
    for ref in refs:
        try:
            idx = int(ref) - 1
        except (TypeError, ValueError):
            continue
        if 0 <= idx < len(slide.image_paths):
            resolved.append(slide.image_paths[idx])
    return resolved


def _extract_usage(response: Any) -> DetectionUsage:
    usage = getattr(response, "usage", None)
    if not usage:
        return DetectionUsage()
    return DetectionUsage(
        prompt_tokens=int(getattr(usage, "input_tokens", 0) or getattr(usage, "prompt_tokens", 0) or 0),
        completion_tokens=int(
            getattr(usage, "output_tokens", 0) or getattr(usage, "completion_tokens", 0) or 0
        ),
        total_tokens=int(getattr(usage, "total_tokens", 0) or 0),
    )
