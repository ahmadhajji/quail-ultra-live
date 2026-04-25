"""
USMLE Question Formatter

Transforms extracted questions into full USMLE/UWorld-style clinical vignettes.
OpenAI is the only supported inference provider.
"""

from __future__ import annotations

import json
import hashlib
import os
import random
import time
from collections import deque
from datetime import datetime
from pathlib import Path
from typing import Optional

from tqdm import tqdm

import sys

sys.path.insert(0, str(Path(__file__).parent.parent))
from ai.rotation_prompts import normalize_rotation_name
from config import OUTPUT_DIR
from domain.models import ExtractedQuestion, USMLEQuestion
from formatting.cache_store import build_progress_snapshot, prepare_cache_state, save_checkpoint
from formatting.choice_randomization import randomize_authored_choices
from formatting.fact_check import FactCheckService
from formatting.prompt_builder import build_prompt
from formatting.response_parser import parse_json_response, repair_json_text
from formatting.scheduler import format_batch_openai_parallel
from providers.formatter.openai_adapter import OpenAIFormatterAdapter
from storage.run_repository import RunRepository
from utils.question_hardening import normalized_stem

FORMATTER_CACHE_VERSION = 2
_RUN_REPOSITORY = RunRepository()

OPENAI_RESPONSE_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "question_stem",
        "question",
        "choices",
        "correct_answer",
        "correct_answer_explanation",
        "incorrect_explanations",
        "educational_objective",
        "tags",
        "quality_flags",
    ],
    "properties": {
        "question_stem": {"type": "string"},
        "question": {"type": "string"},
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
        "correct_answer_explanation": {"type": "string"},
        "incorrect_explanations": {
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
        "educational_objective": {"type": "string"},
        "tags": {
            "type": "object",
            "additionalProperties": False,
            "required": ["rotation", "topic"],
            "properties": {
                "rotation": {"type": "string"},
                "topic": {"type": "string"},
            },
        },
        "quality_flags": {
            "type": "array",
            "items": {"type": "string"},
        },
    },
}


class ModelAccessError(RuntimeError):
    """Raised when the configured model is unavailable or unauthorized."""


class ProviderRateLimitError(RuntimeError):
    """Raised when provider returns rate limiting/quotas."""

    def __init__(self, message: str, retry_after_seconds: float | None = None):
        super().__init__(message)
        self.retry_after_seconds = retry_after_seconds


def atomic_write_json(path: Path, data: dict) -> None:
    """Write JSON atomically using a temp file in the same directory."""
    _RUN_REPOSITORY.atomic_write_json(path, data, indent=2, ensure_ascii=False)


def load_json_file(path: Path) -> dict:
    """Load JSON file if present; return empty dict on missing file."""
    data = _RUN_REPOSITORY.load_json(path, default={})
    if isinstance(data, dict):
        return data
    return {}


class USMLEFormatter:
    """Format extracted questions into USMLE-style clinical vignettes."""

    def __init__(
        self,
        api_key: str,
        model_name: str = "gpt-5.2",
        provider: str = "openai",
        request_timeout_seconds: int = 120,
        http_retry_attempts: int = 2,
        transport: str = "sdk",
        reasoning_effort: str = "high",
        web_search_enabled: bool = True,
        target_rpm: int = 450,
        max_inflight: int = 120,
    ):
        self.api_key = api_key
        self.provider = provider
        self.model_name = model_name
        self.request_timeout_seconds = max(10, int(request_timeout_seconds))
        self.http_retry_attempts = max(1, int(http_retry_attempts))
        self.transport = transport if transport in {"rest", "sdk"} else "rest"
        self.reasoning_effort = reasoning_effort if reasoning_effort in {"low", "medium", "high"} else "high"
        self.web_search_enabled = bool(web_search_enabled)
        self.target_rpm = max(1, int(target_rpm))
        self.max_inflight = max(1, int(max_inflight))

        self.last_request_time = 0.0
        self.min_request_interval = 0.5

        self.openai_client = None
        self.openai_formatter_adapter = None

        if self.provider != "openai":
            raise ValueError(f"Unsupported formatter provider: {provider}")

        try:
            from openai import OpenAI
        except Exception as e:  # pragma: no cover - runtime dependency
            raise RuntimeError("OpenAI dependency missing. Install: pip install openai>=1.0.0") from e
        self.openai_client = OpenAI(api_key=api_key)
        self.openai_formatter_adapter = OpenAIFormatterAdapter(
            client=self.openai_client,
            model_name=self.model_name,
            reasoning_effort=self.reasoning_effort,
            web_search_enabled=self.web_search_enabled,
            response_schema=OPENAI_RESPONSE_SCHEMA,
            model_access_error_factory=lambda message: ModelAccessError(message),
            rate_limit_error_factory=lambda message, retry_after: ProviderRateLimitError(
                message, retry_after_seconds=retry_after
            ),
        )

    def _rate_limit(self) -> None:
        elapsed = time.time() - self.last_request_time
        if elapsed < self.min_request_interval:
            time.sleep(self.min_request_interval - elapsed)
        self.last_request_time = time.time()

    def _build_prompt(self, question: ExtractedQuestion) -> tuple[str, str]:
        return build_prompt(question)

    def _parse_json_response(self, response_text: str) -> dict:
        return parse_json_response(response_text)

    def _repair_json_text(self, text: str) -> str:
        return repair_json_text(text)

    @staticmethod
    def _stable_question_id(question: ExtractedQuestion) -> str:
        return question.question_id or (
            f"{question.slide_number}.{question.question_index}"
            if question.question_index > 1
            else str(question.slide_number)
        )

    def _question_input_hash(self, question: ExtractedQuestion, stable_question_id: str) -> str:
        payload = {
            "cache_version": FORMATTER_CACHE_VERSION,
            "provider": getattr(self, "provider", "openai"),
            "model_name": getattr(self, "model_name", ""),
            "reasoning_effort": getattr(self, "reasoning_effort", "high"),
            "web_search_enabled": bool(getattr(self, "web_search_enabled", True)),
            "question_id": stable_question_id,
            "slide_number": question.slide_number,
            "question_index": question.question_index,
            "variant_label": question.variant_label,
            "question_stem": question.question_stem,
            "choices": question.choices,
            "correct_answer": question.correct_answer,
            "correct_answer_text": question.correct_answer_text,
            "explanation": question.explanation,
            "rotation": question.rotation,
            "images": question.images,
            "explanation_images": question.explanation_images,
            "comments": question.comments,
            "deck_id": question.deck_id,
            "source_group_id": question.source_group_id,
            "source_slide_path": question.source_slide_path,
            "slide_consensus_status": question.slide_consensus_status,
            "related_question_ids": question.related_question_ids,
            "dedupe_fingerprint": question.dedupe_fingerprint,
            "warnings": question.warnings,
            "fact_check": question.fact_check,
        }
        encoded = json.dumps(payload, sort_keys=True, ensure_ascii=False).encode("utf-8")
        return hashlib.sha256(encoded).hexdigest()

    def _source_fingerprint(self, valid_questions: list[ExtractedQuestion]) -> str:
        normalized = []
        for question in valid_questions:
            stable_question_id = self._stable_question_id(question)
            normalized.append(
                {
                    "question_id": stable_question_id,
                    "input_hash": self._question_input_hash(question, stable_question_id),
                }
            )
        encoded = json.dumps(sorted(normalized, key=lambda x: x["question_id"]), sort_keys=True).encode("utf-8")
        return hashlib.sha256(encoded).hexdigest()

    def _extract_retry_after_seconds(self, message: str) -> float | None:
        return OpenAIFormatterAdapter.extract_retry_after_seconds(message)

    def _is_rate_limit_error(self, message: str) -> bool:
        return OpenAIFormatterAdapter.is_rate_limit_error(message)

    def _is_model_access_error(self, message: str) -> bool:
        return OpenAIFormatterAdapter.is_model_access_error(message)

    def _short_error(self, message: str) -> str:
        one_line = " ".join((message or "").split())
        return one_line[:280]

    def _get_openai_formatter_adapter(self) -> OpenAIFormatterAdapter:
        adapter = getattr(self, "openai_formatter_adapter", None)
        if adapter is not None:
            return adapter

        openai_client = getattr(self, "openai_client", None)
        if openai_client is None:
            raise RuntimeError("OpenAI formatter client not initialized")

        adapter = OpenAIFormatterAdapter(
            client=openai_client,
            model_name=getattr(self, "model_name", "gpt-5.2"),
            reasoning_effort=getattr(self, "reasoning_effort", "high"),
            web_search_enabled=bool(getattr(self, "web_search_enabled", True)),
            response_schema=OPENAI_RESPONSE_SCHEMA,
            model_access_error_factory=lambda message: ModelAccessError(message),
            rate_limit_error_factory=lambda message, retry_after: ProviderRateLimitError(
                message, retry_after_seconds=retry_after
            ),
        )
        self.openai_formatter_adapter = adapter
        return adapter

    def _generate_content_openai(self, prompt: str) -> tuple[str, list[str]]:
        return self._get_openai_formatter_adapter().generate_content(prompt)

    @staticmethod
    def _validate_formatted_question(result: USMLEQuestion) -> list[str]:
        errors: list[str] = []

        if not str(result.question_stem or "").strip():
            errors.append("Formatter returned an empty question_stem")
        if not str(result.question or "").strip():
            errors.append("Formatter returned an empty question body")

        cleaned_choices = {
            str(letter): str(text).strip()
            for letter, text in (result.choices or {}).items()
            if str(text).strip()
        }
        if not cleaned_choices:
            errors.append("Formatter returned no answer choices")
        if result.correct_answer not in cleaned_choices:
            errors.append("Correct answer is not present in formatted choices")

        normalized_texts = [normalized_stem(text) for text in cleaned_choices.values() if normalized_stem(text)]
        if len(set(normalized_texts)) != len(normalized_texts):
            errors.append("Formatter returned duplicate choice text")

        distractor_letters = {letter for letter in cleaned_choices if letter != result.correct_answer}
        explanation_letters = {letter for letter, text in (result.incorrect_explanations or {}).items() if str(text).strip()}
        if explanation_letters - distractor_letters:
            result.incorrect_explanations = {
                letter: text
                for letter, text in (result.incorrect_explanations or {}).items()
                if letter in distractor_letters
            }

        if not str(result.correct_answer_explanation or "").strip():
            errors.append("Formatter returned an empty correct-answer explanation")
        if not str(result.educational_objective or "").strip():
            errors.append("Formatter returned an empty educational objective")

        return errors

    def format_question(self, question: ExtractedQuestion, question_id: str | int, retries: int = 3) -> USMLEQuestion:
        """Transform one extracted question into USMLE format."""
        result = USMLEQuestion(
            original_slide_number=question.slide_number,
            original_question_index=question.question_index,
            question_id=str(question_id),
            images=question.images.copy() if question.images else [],
            explanation_images=question.explanation_images.copy() if question.explanation_images else [],
            comments=question.comments.copy() if question.comments else [],
            deck_id=question.deck_id,
            source_group_id=question.source_group_id,
            source_slide_path=question.source_slide_path,
            slide_consensus_status=question.slide_consensus_status,
            related_question_ids=question.related_question_ids.copy() if question.related_question_ids else [],
            dedupe_fingerprint=question.dedupe_fingerprint,
            warnings=question.warnings.copy() if question.warnings else [],
            fact_check=dict(question.fact_check) if question.fact_check else {},
            extraction_classification=question.classification,
            review_status=question.review_status,
            review_reasons=question.review_reasons.copy() if question.review_reasons else [],
            validation=dict(question.validation) if question.validation else {},
        )

        prompt, canonical_rotation = self._build_prompt(question)

        for attempt in range(max(1, retries)):
            try:
                response_text, grounding_sources = self._generate_content_openai(prompt)

                result.raw_response = response_text
                result.grounding_sources = grounding_sources
                data = self._parse_json_response(response_text)

                result.question_stem = data.get("question_stem", "")
                result.question = data.get("question", "")
                raw_choices = data.get("choices", {})
                if not isinstance(raw_choices, dict):
                    raw_choices = {}
                # Drop empty placeholder choice keys (typically "E" for 4-option items).
                cleaned_choices = {
                    str(letter): str(text).strip() for letter, text in raw_choices.items() if str(text).strip()
                }
                result.choices = cleaned_choices or raw_choices
                result.correct_answer = data.get("correct_answer", "")
                result.correct_answer_explanation = data.get("correct_answer_explanation", "")
                raw_incorrect = data.get("incorrect_explanations", {})
                if not isinstance(raw_incorrect, dict):
                    raw_incorrect = {}
                result.incorrect_explanations = {
                    str(letter): str(explanation).strip()
                    for letter, explanation in raw_incorrect.items()
                    if str(explanation).strip()
                }
                result.educational_objective = data.get("educational_objective", "")

                tags = data.get("tags", {})
                if not isinstance(tags, dict):
                    tags = {}

                response_rotation = str(tags.get("rotation", "")).strip()
                try:
                    response_rotation = (
                        normalize_rotation_name(response_rotation) if response_rotation else canonical_rotation
                    )
                except ValueError:
                    response_rotation = canonical_rotation

                topic = str(tags.get("topic", "")).strip()
                if not topic:
                    topic = str(tags.get("system") or tags.get("discipline") or "Untagged")

                result.tags = {
                    "rotation": response_rotation,
                    "topic": topic,
                }
                validation_errors = self._validate_formatted_question(result)
                if validation_errors:
                    result.error = "; ".join(validation_errors)
                    return result
                result.choice_text_by_letter = dict(result.choices)
                result.choice_presentation = {
                    "shuffle_allowed": True,
                    "display_order": list(result.choices.keys()),
                }
                return result

            except ModelAccessError:
                raise
            except ProviderRateLimitError as e:
                if attempt == retries - 1:
                    retry_after = (
                        e.retry_after_seconds
                        if e.retry_after_seconds is not None
                        else self._extract_retry_after_seconds(str(e))
                    )
                    if retry_after is not None:
                        result.error = f"HTTP 429: {e}. retry_after={retry_after:.2f}"
                    else:
                        result.error = f"HTTP 429: {e}"
                else:
                    delay = (2**attempt) + random.uniform(0.1, 0.7)
                    time.sleep(delay)
            except Exception as e:
                if attempt == retries - 1:
                    result.error = str(e)
                else:
                    delay = (2**attempt) + random.uniform(0.1, 0.7)
                    time.sleep(delay)

        return result

    def _prepare_cache_state(
        self,
        valid_questions: list[ExtractedQuestion],
        source_label: str,
        cache_file: Path | None,
        logger: callable,
    ) -> tuple[dict, dict[str, USMLEQuestion], int, list[ExtractedQuestion]]:
        return prepare_cache_state(
            valid_questions=valid_questions,
            source_label=source_label,
            cache_file=cache_file,
            logger=logger,
            cache_version=FORMATTER_CACHE_VERSION,
            provider=getattr(self, "provider", "openai"),
            model_name=getattr(self, "model_name", "gpt-5.2"),
            reasoning_effort=getattr(self, "reasoning_effort", "high"),
            web_search_enabled=bool(getattr(self, "web_search_enabled", True)),
            source_fingerprint=self._source_fingerprint(valid_questions),
            stable_question_id=self._stable_question_id,
            question_input_hash=self._question_input_hash,
            load_json_file=load_json_file,
        )

    def format_batch(
        self,
        questions: list[ExtractedQuestion],
        progress_callback: Optional[callable] = None,
        checkpoint_every: int = 5,
        cache_path: str | Path | None = None,
        progress_path: str | Path | None = None,
        source_label: str = "unknown",
        logger: Optional[callable] = None,
        checkpoint_callback: Optional[callable] = None,
    ) -> list[USMLEQuestion]:
        """Format multiple questions with cache-aware resume support."""

        valid_questions = [q for q in questions if q.is_approved_for_formatting()]
        if not valid_questions:
            return []

        log = logger or (lambda _msg: None)
        checkpoint_every = max(1, checkpoint_every)

        question_ids = [self._stable_question_id(q) for q in valid_questions]
        counts: dict[str, int] = {}
        for qid in question_ids:
            counts[qid] = counts.get(qid, 0) + 1
        duplicate_ids = sorted([qid for qid, count in counts.items() if count > 1])
        if duplicate_ids:
            raise ValueError(
                "Duplicate question_id values found in formatting input: "
                f"{duplicate_ids[:5]}. Ensure IDs are unique before formatting."
            )

        cache_file = Path(cache_path) if cache_path else None
        progress_file = Path(progress_path) if progress_path else None

        cache_payload, results_by_id, cache_hits, pending_questions = self._prepare_cache_state(
            valid_questions=valid_questions,
            source_label=source_label,
            cache_file=cache_file,
            logger=log,
        )

        metrics = {
            "api_calls": 0,
            "inflight_current": 0,
            "last_error_summary": "",
        }
        request_starts: deque[float] = deque()

        def progress_snapshot(last_question_id: str = "") -> dict:
            return build_progress_snapshot(
                cache_version=FORMATTER_CACHE_VERSION,
                provider_name=getattr(self, "provider", "openai"),
                model_name=getattr(self, "model_name", "gpt-5.2"),
                reasoning_effort=getattr(self, "reasoning_effort", "high"),
                web_search_enabled=bool(getattr(self, "web_search_enabled", True)),
                source_label=source_label,
                source_fingerprint=cache_payload.get("source_fingerprint"),
                total_questions=len(valid_questions),
                results_by_id=results_by_id,
                cache_hits=cache_hits,
                metrics=metrics,
                request_starts=request_starts,
                now_ts=time.time(),
                updated_at=datetime.now().isoformat(),
                last_question_id=last_question_id,
            )

        def persist_checkpoint(last_question_id: str = "") -> None:
            save_checkpoint(
                cache_payload=cache_payload,
                cache_file=cache_file,
                progress_file=progress_file,
                atomic_write_json=atomic_write_json,
                progress_snapshot_factory=progress_snapshot,
                last_question_id=last_question_id,
            )
            if checkpoint_callback:
                checkpoint_callback(last_question_id, results_by_id, valid_questions, cache_payload)

        if progress_callback:
            progress_callback(len(results_by_id), len(valid_questions))

        self._format_batch_openai_parallel(
            pending_questions=pending_questions,
            results_by_id=results_by_id,
            cache_payload=cache_payload,
            request_starts=request_starts,
            checkpoint_every=checkpoint_every,
            save_checkpoint=persist_checkpoint,
            progress_callback=progress_callback,
            progress_total=len(valid_questions),
            metrics=metrics,
        )

        persist_checkpoint()

        ordered_results: list[USMLEQuestion] = []
        for q in valid_questions:
            ordered_results.append(results_by_id[self._stable_question_id(q)])
        return ordered_results

    def _format_batch_openai_parallel(
        self,
        pending_questions: list[ExtractedQuestion],
        results_by_id: dict[str, USMLEQuestion],
        cache_payload: dict,
        request_starts: deque[float],
        checkpoint_every: int,
        save_checkpoint: callable,
        progress_callback: Optional[callable],
        progress_total: int,
        metrics: dict,
    ) -> None:
        format_batch_openai_parallel(
            pending_questions=pending_questions,
            results_by_id=results_by_id,
            cache_payload=cache_payload,
            request_starts=request_starts,
            checkpoint_every=checkpoint_every,
            save_checkpoint=save_checkpoint,
            progress_callback=progress_callback,
            progress_total=progress_total,
            metrics=metrics,
            stable_question_id=self._stable_question_id,
            question_input_hash=self._question_input_hash,
            format_question=self.format_question,
            is_rate_limit_error=self._is_rate_limit_error,
            extract_retry_after_seconds=self._extract_retry_after_seconds,
            short_error=self._short_error,
            target_rpm=max(1, int(getattr(self, "target_rpm", 450))),
            max_inflight=max(1, int(getattr(self, "max_inflight", 120))),
            model_access_error_cls=ModelAccessError,
        )


def export_usmle_questions(
    questions: list[USMLEQuestion],
    output_path: str | Path,
    format: str = "json",
    model_used: str = "gpt-5.2",
    provider_used: str = "openai",
) -> Path:
    """Export USMLE-formatted questions."""
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    if format == "json":
        data = {
            "total_questions": len(questions),
            "model_used": model_used,
            "provider_used": provider_used,
            "features": ["thinking_high", "web_grounding"],
            "questions": [q.to_dict() for q in questions],
        }
        atomic_write_json(output_path, data)

    elif format == "markdown":
        tmp_path = output_path.with_suffix(f"{output_path.suffix}.tmp.{os.getpid()}.{int(time.time() * 1000)}")
        try:
            with open(tmp_path, "w", encoding="utf-8") as f:
                f.write("# USMLE Question Bank\n\n")
                f.write(f"*Generated with {provider_used}:{model_used} (thinking + web grounding)*\n\n")
                for i, q in enumerate(questions, 1):
                    f.write(f"---\n\n# Question {i}\n\n")
                    f.write(q.to_markdown())
                    f.write("\n\n")
            os.replace(tmp_path, output_path)
        finally:
            if tmp_path.exists():
                tmp_path.unlink(missing_ok=True)

    return output_path


def apply_fact_check_and_randomization(
    questions: list[ExtractedQuestion],
    *,
    api_key: str,
    model_name: str,
    reasoning_effort: str,
    web_search_enabled: bool,
) -> list[ExtractedQuestion]:
    """Run fact-check before formatting so auto-rekeys feed the formatter."""
    service = FactCheckService(
        api_key=api_key,
        model_name=model_name,
        reasoning_effort=reasoning_effort,
        web_search_enabled=web_search_enabled,
        cache_path=OUTPUT_DIR / "usmle_fact_check_cache.json",
    )
    return service.apply(questions)


def randomize_formatted_questions(questions: list[USMLEQuestion]) -> list[USMLEQuestion]:
    """Apply deterministic authored choice randomization to formatted questions."""
    return [randomize_authored_choices(question) for question in questions]
