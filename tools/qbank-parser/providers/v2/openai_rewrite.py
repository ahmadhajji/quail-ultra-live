"""Stage 3 rewrite adapter — OpenAI USMLE rewrite call per question.

One AI call per question. Uses the rotation-specific master prompt from
ai/rotation_prompt_templates/*.txt (the accuracy lever) wrapped with a
strict JSON output schema.

Model: gpt-5.4 (full, NOT mini) at HIGH reasoning effort. This is the
single most important quality lever in the pipeline.

If the rewrite output fails validation (missing educational objective,
empty incorrect explanations, etc.), retry ONCE with the same model
before marking the question as error.

No web search. No escalation. The source is the authority.
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass
from typing import Any

from ai.rotation_prompts import build_rotation_formatter_prompt, normalize_rotation_name
from domain.models import DetectedQuestion, RewrittenQuestion

logger = logging.getLogger(__name__)

REWRITE_PROMPT_VERSION = "v2-rewrite-1"

DEFAULT_REWRITE_MODEL = "gpt-5.4"
DEFAULT_REWRITE_REASONING_EFFORT = "high"

MAX_RETRIES = 3
INITIAL_BACKOFF_SECONDS = 2.0


REWRITE_SYSTEM_PROMPT = (
    "You are a senior USMLE question writer. Convert the provided rough "
    "question content into a polished USMLE-style vignette that meets the "
    "accuracy and style requirements of the rotation master prompt below.\n\n"
    "Critical rules:\n"
    "1. Preserve the source's clinical intent. The professor's answer is the "
    "correct answer — do not second-guess it from external knowledge.\n"
    "2. Every non-correct choice must have a non-empty explanation describing "
    "why it is wrong.\n"
    "3. The educational objective must be a clear, single takeaway sentence.\n"
    "4. Return strict JSON. No markdown, no commentary, no surrounding text."
)


REWRITE_RESPONSE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "question_stem": {"type": "string"},
        "question": {"type": "string"},
        "choices": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "letter": {"type": "string"},
                    "text": {"type": "string"},
                },
                "required": ["letter", "text"],
            },
        },
        "correct_answer": {"type": "string"},
        "correct_answer_explanation": {"type": "string"},
        "incorrect_explanations": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "letter": {"type": "string"},
                    "explanation": {"type": "string"},
                },
                "required": ["letter", "explanation"],
            },
        },
        "educational_objective": {"type": "string"},
        "tags": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "rotation": {"type": "string"},
                "topic": {"type": "string"},
            },
            "required": ["rotation", "topic"],
        },
    },
    "required": [
        "question_stem",
        "question",
        "choices",
        "correct_answer",
        "correct_answer_explanation",
        "incorrect_explanations",
        "educational_objective",
        "tags",
    ],
}


@dataclass
class RewriteUsage:
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0


@dataclass
class RewriteResult:
    """Result of rewriting a single question."""

    question_id: str
    question: RewrittenQuestion | None
    usage: RewriteUsage = None  # type: ignore[assignment]
    attempts: int = 0
    error: str = ""

    def __post_init__(self):
        if self.usage is None:
            self.usage = RewriteUsage()


class OpenAIRewriteAdapter:
    """Stage 3 — rotation-aware USMLE rewrite of one detected question."""

    def __init__(
        self,
        api_key: str,
        model_name: str = DEFAULT_REWRITE_MODEL,
        reasoning_effort: str = DEFAULT_REWRITE_REASONING_EFFORT,
        client: Any = None,
    ):
        if not api_key:
            raise ValueError("OPENAI_API_KEY is required for v2 rewrite adapter")
        self.api_key = api_key
        self.model_name = model_name
        self.reasoning_effort = reasoning_effort
        if client is not None:
            self._client = client
        else:
            from openai import OpenAI

            self._client = OpenAI(api_key=api_key)

    def rewrite(self, detected: DetectedQuestion, rotation: str) -> RewriteResult:
        """Rewrite a single detected question into a polished USMLE question.

        On JSON parse failure or strict-validation failure, retry ONCE with
        the same prompt before reporting an error.
        """
        canonical_rotation = normalize_rotation_name(rotation)
        user_prompt = self._build_user_prompt(detected, canonical_rotation)

        last_error: str | None = None
        usage_total = RewriteUsage()
        validation_retried = False

        for attempt in range(1, MAX_RETRIES + 1):
            try:
                response = self._client.responses.create(
                    model=self.model_name,
                    reasoning={"effort": self.reasoning_effort},
                    input=[
                        {"role": "system", "content": REWRITE_SYSTEM_PROMPT},
                        {"role": "user", "content": [{"type": "input_text", "text": user_prompt}]},
                    ],
                    text={
                        "format": {
                            "type": "json_schema",
                            "name": "RewrittenQuestion",
                            "schema": REWRITE_RESPONSE_SCHEMA,
                            "strict": True,
                        }
                    },
                )
            except Exception as exc:  # broad: network / rate-limit / parse all retry
                last_error = str(exc)
                if attempt < MAX_RETRIES:
                    sleep_for = INITIAL_BACKOFF_SECONDS * (2 ** (attempt - 1))
                    logger.warning(
                        "Stage 3 rewrite failed for %s (attempt %s): %s — retrying in %.1fs",
                        detected.question_id,
                        attempt,
                        last_error,
                        sleep_for,
                    )
                    time.sleep(sleep_for)
                    continue
                break

            usage_total = _accumulate_usage(usage_total, response)
            parsed, parse_err = self._parse_response(response)
            if parse_err:
                last_error = parse_err
                if attempt < MAX_RETRIES:
                    sleep_for = INITIAL_BACKOFF_SECONDS * (2 ** (attempt - 1))
                    logger.warning(
                        "Stage 3 rewrite parse error for %s (attempt %s): %s — retrying in %.1fs",
                        detected.question_id,
                        attempt,
                        last_error,
                        sleep_for,
                    )
                    time.sleep(sleep_for)
                    continue
                break

            question = _build_rewritten_question(
                detected,
                parsed,
                canonical_rotation,
                self.model_name,
            )
            if question.is_complete():
                return RewriteResult(
                    question_id=detected.question_id,
                    question=question,
                    usage=usage_total,
                    attempts=attempt,
                )

            # Validation gate: retry ONCE with same prompt before failing
            if not validation_retried and attempt < MAX_RETRIES:
                validation_retried = True
                logger.warning(
                    "Stage 3 rewrite for %s failed validation gate (attempt %s) — retrying",
                    detected.question_id,
                    attempt,
                )
                continue

            last_error = "validation gate failed (incomplete output)"
            break

        return RewriteResult(
            question_id=detected.question_id,
            question=None,
            usage=usage_total,
            attempts=MAX_RETRIES if last_error else 0,
            error=last_error or "unknown error",
        )

    def _build_user_prompt(self, detected: DetectedQuestion, canonical_rotation: str) -> str:
        """Compose the rotation-specific master prompt with the detected content as input."""
        choices_text = "; ".join(f"{k}: {v}" for k, v in detected.choices.items())
        explanation = detected.explanation_hint or "(no explanation provided in source)"
        if detected.speaker_notes:
            explanation = f"{explanation}\n\nSPEAKER NOTES: {detected.speaker_notes}"
        if detected.comments:
            comments_text = "\n".join(
                f"- [{c.get('author', 'Unknown')}] {c.get('content', '')}"
                for c in detected.comments
                if c.get("content")
            )
            if comments_text:
                explanation = f"{explanation}\n\nDECK COMMENTS (authoritative):\n{comments_text}"
        if detected.highlighted_texts:
            explanation = (
                f"{explanation}\n\nHIGHLIGHTED TEXT (correct-answer signal): "
                f"{', '.join(detected.highlighted_texts)}"
            )

        has_images = "yes" if (detected.stem_image_paths or detected.explanation_image_paths) else "no"

        return build_rotation_formatter_prompt(
            rotation=canonical_rotation,
            question_stem=detected.stem_text or "(see source)",
            choices=choices_text or "(no choices in source)",
            correct_answer=detected.correct_answer or "(unknown)",
            explanation=explanation,
            slide_number=detected.slide_number,
            has_images=has_images,
        )

    def _parse_response(self, response: Any) -> tuple[dict | None, str]:
        raw_text = getattr(response, "output_text", None)
        if not raw_text:
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
            return None, "empty response from model"
        try:
            return json.loads(raw_text), ""
        except json.JSONDecodeError as exc:
            return None, f"json parse error: {exc}"


def _build_rewritten_question(
    detected: DetectedQuestion,
    payload: dict,
    rotation: str,
    model_name: str,
) -> RewrittenQuestion:
    """Map the model's JSON payload into a RewrittenQuestion."""
    stem_parts: list[str] = []
    main_stem = str(payload.get("question_stem", "") or "").strip()
    lead_in = str(payload.get("question", "") or "").strip()
    if main_stem:
        stem_parts.append(main_stem)
    if lead_in and lead_in not in main_stem:
        stem_parts.append(lead_in)
    stem = "\n\n".join(stem_parts).strip()

    # choices is a list of {letter, text} (strict schema format)
    raw_choices = payload.get("choices") or []
    if isinstance(raw_choices, list):
        choices = {
            str(c.get("letter", "")).strip().upper(): str(c.get("text", "")).strip()
            for c in raw_choices
            if c.get("letter") and c.get("text")
        }
    else:
        choices = {k: str(v).strip() for k, v in raw_choices.items() if str(v).strip()}

    correct_answer = str(payload.get("correct_answer", "") or "").strip().upper()
    correct_explanation = str(payload.get("correct_answer_explanation", "") or "").strip()

    # incorrect_explanations is a list of {letter, explanation}
    raw_incorrect = payload.get("incorrect_explanations") or []
    if isinstance(raw_incorrect, list):
        incorrect_explanations = {
            str(item.get("letter", "")).strip().upper(): str(item.get("explanation", "")).strip()
            for item in raw_incorrect
            if item.get("letter") and item.get("explanation")
        }
    else:
        incorrect_explanations = {
            str(k).strip().upper(): str(v).strip()
            for k, v in raw_incorrect.items()
            if str(v).strip()
        }

    educational_objective = str(payload.get("educational_objective", "") or "").strip()
    tags = payload.get("tags") or {}
    tag_rotation = str(tags.get("rotation", rotation) or rotation).strip()
    tag_topic = str(tags.get("topic", "") or "").strip()

    return RewrittenQuestion(
        deck_id=detected.deck_id,
        slide_number=detected.slide_number,
        question_index=detected.question_index,
        question_id=detected.question_id,
        stem=stem,
        choices=choices,
        correct_answer=correct_answer,
        correct_explanation=correct_explanation,
        incorrect_explanations=incorrect_explanations,
        educational_objective=educational_objective,
        rotation=tag_rotation or rotation,
        topic=tag_topic,
        stem_image_paths=list(detected.stem_image_paths),
        explanation_image_paths=list(detected.explanation_image_paths),
        source_slide_path=detected.source_slide_path,
        comments=list(detected.comments),
        warnings=list(detected.detection_warnings),
        detect_model=detected.detect_model,
        rewrite_model=model_name,
        rewrite_prompt_version=REWRITE_PROMPT_VERSION,
    )


def _accumulate_usage(running: RewriteUsage, response: Any) -> RewriteUsage:
    usage = getattr(response, "usage", None)
    if not usage:
        return running
    return RewriteUsage(
        prompt_tokens=running.prompt_tokens
        + int(getattr(usage, "input_tokens", 0) or getattr(usage, "prompt_tokens", 0) or 0),
        completion_tokens=running.completion_tokens
        + int(getattr(usage, "output_tokens", 0) or getattr(usage, "completion_tokens", 0) or 0),
        total_tokens=running.total_tokens + int(getattr(usage, "total_tokens", 0) or 0),
    )
