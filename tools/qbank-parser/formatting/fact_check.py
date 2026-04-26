"""Fact-check extracted questions before USMLE formatting."""

from __future__ import annotations

import hashlib
import json
from copy import deepcopy
from pathlib import Path

from ai.rotation_prompts import normalize_rotation_name
from domain.models import ExtractedQuestion
from formatting.response_parser import parse_json_response
from providers.formatter.openai_adapter import OpenAIFormatterAdapter
from storage.run_repository import RunRepository
from utils.question_hardening import sanitize_choice_map, strip_bat_markers


FACT_CHECK_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["status", "note", "recommended_answer", "recommended_answer_text"],
    "properties": {
        "status": {"type": "string", "enum": ["confirmed", "disputed", "unresolved"]},
        "note": {"type": "string"},
        "recommended_answer": {"type": "string"},
        "recommended_answer_text": {"type": "string"},
    },
}


class FactCheckService:
    """OpenAI-backed fact-check pass for extracted questions."""

    CACHE_VERSION = 1

    def __init__(
        self,
        *,
        api_key: str,
        model_name: str,
        reasoning_effort: str,
        web_search_enabled: bool,
        routine_model_name: str = "",
        routine_reasoning_effort: str = "high",
        escalation_model_name: str = "",
        escalation_reasoning_effort: str = "xhigh",
        escalation_confidence_threshold: int = 70,
        cache_path: str | Path | None = None,
    ):
        from openai import OpenAI

        self.model_name = model_name
        self.reasoning_effort = reasoning_effort
        self.web_search_enabled = bool(web_search_enabled)
        self.routine_model_name = (routine_model_name or "gpt-5.4-mini").strip()
        self.routine_reasoning_effort = (routine_reasoning_effort or "high").strip().lower()
        self.escalation_model_name = (escalation_model_name or "").strip()
        self.escalation_reasoning_effort = (escalation_reasoning_effort or "xhigh").strip().lower()
        self.escalation_confidence_threshold = int(escalation_confidence_threshold)
        self.repo = RunRepository()
        self.cache_path = Path(cache_path) if cache_path else None
        client = OpenAI(api_key=api_key)
        self.routine_adapter = OpenAIFormatterAdapter(
            client=client,
            model_name=self.routine_model_name,
            reasoning_effort=self.routine_reasoning_effort,
            web_search_enabled=False,
            response_schema=FACT_CHECK_SCHEMA,
            model_access_error_factory=lambda message: RuntimeError(message),
            rate_limit_error_factory=lambda message, _retry_after: RuntimeError(message),
        )
        self.risk_adapter = OpenAIFormatterAdapter(
            client=client,
            model_name=model_name,
            reasoning_effort=reasoning_effort,
            web_search_enabled=web_search_enabled,
            response_schema=FACT_CHECK_SCHEMA,
            model_access_error_factory=lambda message: RuntimeError(message),
            rate_limit_error_factory=lambda message, _retry_after: RuntimeError(message),
        )
        self.escalation_adapter = None
        if self.escalation_model_name:
            self.escalation_adapter = OpenAIFormatterAdapter(
                client=client,
                model_name=self.escalation_model_name,
                reasoning_effort=self.escalation_reasoning_effort,
                web_search_enabled=True,
                response_schema=FACT_CHECK_SCHEMA,
                model_access_error_factory=lambda message: RuntimeError(message),
                rate_limit_error_factory=lambda message, _retry_after: RuntimeError(message),
            )
        self.cache = self._load_cache()

    def _load_cache(self) -> dict:
        if not self.cache_path:
            return {"version": self.CACHE_VERSION, "entries": {}}
        try:
            payload = self.repo.load_json(self.cache_path, default={})
        except Exception:
            payload = {}
        if (
            isinstance(payload, dict)
            and payload.get("version") == self.CACHE_VERSION
            and payload.get("model_name") == self.model_name
            and payload.get("reasoning_effort") == self.reasoning_effort
            and bool(payload.get("web_search_enabled")) == self.web_search_enabled
            and payload.get("routine_model_name") == self.routine_model_name
            and payload.get("routine_reasoning_effort") == self.routine_reasoning_effort
            and payload.get("escalation_model_name") == self.escalation_model_name
            and payload.get("escalation_reasoning_effort") == self.escalation_reasoning_effort
            and int(payload.get("escalation_confidence_threshold", 70)) == self.escalation_confidence_threshold
            and isinstance(payload.get("entries"), dict)
        ):
            return payload
        return {
            "version": self.CACHE_VERSION,
            "model_name": self.model_name,
            "reasoning_effort": self.reasoning_effort,
            "web_search_enabled": self.web_search_enabled,
            "routine_model_name": self.routine_model_name,
            "routine_reasoning_effort": self.routine_reasoning_effort,
            "escalation_model_name": self.escalation_model_name,
            "escalation_reasoning_effort": self.escalation_reasoning_effort,
            "escalation_confidence_threshold": self.escalation_confidence_threshold,
            "entries": {},
        }

    def _should_escalate(self, question: ExtractedQuestion) -> bool:
        return (
            self.escalation_adapter is not None and int(question.confidence or 0) < self.escalation_confidence_threshold
        )

    @staticmethod
    def _risk_reasons(question: ExtractedQuestion) -> list[str]:
        reasons: list[str] = []
        flags = [str(item).lower() for item in (question.flags or [])]
        warnings = [str(item).lower() for item in (question.warnings or [])]
        review_reasons = [str(item).lower() for item in (question.review_reasons or [])]
        combined = " ".join([*flags, *warnings, *review_reasons])
        choices = sanitize_choice_map(question.choices)
        if question.classification == "needs_review":
            reasons.append("needs_review")
        if int(question.confidence or 0) < 85:
            reasons.append("low_confidence")
        if question.extraction_method == "vision":
            reasons.append("vision_ocr")
        if len([value for value in choices.values() if str(value).strip()]) < 4:
            reasons.append("incomplete_choices")
        if not str(question.correct_answer or "").strip() or not str(question.correct_answer_text or "").strip():
            reasons.append("missing_answer_key")
        if any(
            term in combined
            for term in [
                "infer",
                "conflict",
                "disagree",
                "duplicate",
                "messy",
                "corrupted",
                "incomplete",
                "not clear",
                "verify",
            ]
        ):
            reasons.append("extraction_uncertainty")
        comments_text = " ".join(
            str(item.get("content", "")) for item in (question.comments or []) if isinstance(item, dict)
        ).lower()
        if any(
            term in comments_text
            for term in ["wrong", "not", "instead", "answer", "why", "conflict", "disagree", "check"]
        ):
            reasons.append("comment_answer_discussion")
        return sorted(set(reasons))

    def _active_adapter(self, question: ExtractedQuestion) -> tuple[OpenAIFormatterAdapter, bool, bool, list[str]]:
        risk_reasons = self._risk_reasons(question)
        if self._should_escalate(question):
            return self.escalation_adapter, True, True, ["critical_low_confidence", *risk_reasons]  # type: ignore[return-value]
        if risk_reasons and self.web_search_enabled:
            return self.risk_adapter, False, True, risk_reasons
        return self.routine_adapter, False, False, risk_reasons

    def _save_cache(self) -> None:
        if self.cache_path:
            self.repo.atomic_write_json(self.cache_path, self.cache, indent=2, ensure_ascii=False)

    def _question_input_hash(self, question: ExtractedQuestion) -> str:
        payload = {
            "version": self.CACHE_VERSION,
            "active": self._active_adapter(question)[0].model_name,
            "risk_reasons": self._risk_reasons(question),
            "question_id": question.question_id,
            "confidence": question.confidence,
            "question_stem": question.question_stem,
            "choices": sanitize_choice_map(question.choices),
            "correct_answer": question.correct_answer,
            "correct_answer_text": question.correct_answer_text,
            "explanation": question.explanation,
            "rotation": question.rotation,
            "comments": question.comments,
        }
        encoded = json.dumps(payload, sort_keys=True, ensure_ascii=False).encode("utf-8")
        return hashlib.sha256(encoded).hexdigest()

    def _build_prompt(self, question: ExtractedQuestion, *, escalated: bool = False) -> str:
        choices = sanitize_choice_map(question.choices)
        choices_text = "\n".join(f"{letter}: {text}" for letter, text in choices.items() if text)
        comments_text = "\n".join(
            strip_bat_markers(str(item.get("content", "")))
            for item in (question.comments or [])
            if isinstance(item, dict)
        ).strip()
        try:
            rotation = normalize_rotation_name(question.rotation) if question.rotation else "Internal Medicine"
        except ValueError:
            rotation = "Internal Medicine"
        escalation_instruction = (
            "This item was flagged as low-confidence by extraction. Perform a deeper investigation: "
            "actively check current high-quality sources, resolve edge cases, and be conservative if evidence is mixed.\n"
            if escalated
            else ""
        )
        return (
            "You are fact-checking a medical recall question before export.\n"
            "Decide if the currently keyed answer is medically accurate.\n"
            "Use web grounding when available. Respond in JSON only.\n\n"
            f"{escalation_instruction}"
            f"Rotation: {rotation}\n"
            f"Extraction confidence: {int(question.confidence or 0)}\n"
            f"Question stem: {strip_bat_markers(question.question_stem)}\n"
            f"Choices:\n{choices_text or 'None'}\n"
            f"Current correct answer: {question.correct_answer}\n"
            f"Current correct answer text: {strip_bat_markers(question.correct_answer_text)}\n"
            f"Explanation/context: {strip_bat_markers(question.explanation)}\n"
            f"Comments: {comments_text or 'None'}\n\n"
            "Return status as:\n"
            "- confirmed: keyed answer looks correct\n"
            "- disputed: keyed answer likely incorrect or misleading\n"
            "- unresolved: not enough evidence\n"
            "If disputed and another option is clearly better, include recommended_answer as the option letter and recommended_answer_text."
        )

    def check_question(self, question: ExtractedQuestion) -> tuple[dict, list[str]]:
        cache_key = self._question_input_hash(question)
        cached = self.cache.get("entries", {}).get(cache_key, {})
        if isinstance(cached, dict) and isinstance(cached.get("payload"), dict):
            payload = dict(cached["payload"])
            payload["cache_hit"] = True
            sources = payload.get("sources", [])
            return payload, sources if isinstance(sources, list) else []

        adapter, escalated, risk_web_search, risk_reasons = self._active_adapter(question)
        response_text, sources = adapter.generate_content(
            self._build_prompt(question, escalated=escalated),
            stage="fact_check",
            method="fact_check",
            slide_number=question.slide_number,
        )
        data = parse_json_response(response_text)
        payload = {
            "status": str(data.get("status", "unresolved")).strip() or "unresolved",
            "note": str(data.get("note", "")).strip(),
            "recommended_answer": str(data.get("recommended_answer", "")).strip().upper(),
            "recommended_answer_text": strip_bat_markers(str(data.get("recommended_answer_text", "")).strip()),
            "model": adapter.model_name,
            "reasoning_effort": adapter.reasoning_effort,
            "web_search_enabled": adapter.web_search_enabled,
            "escalated": escalated,
            "risk_reasons": risk_reasons,
            "risk_web_search": risk_web_search,
            "escalation_reason": (
                f"confidence {int(question.confidence or 0)} < {self.escalation_confidence_threshold}"
                if escalated
                else ""
            ),
            "sources": sources,
            "cache_hit": False,
        }
        self.cache.setdefault("entries", {})[cache_key] = {"payload": payload}
        self._save_cache()
        return payload, sources

    def apply(self, questions: list[ExtractedQuestion], logger=None) -> list[ExtractedQuestion]:
        checked: list[ExtractedQuestion] = []
        for question in questions:
            current = deepcopy(question)
            if current.classification in {"rejected", "error"} or current.review_status in {
                "rejected",
                "skipped",
                "quit",
            }:
                checked.append(current)
                continue
            try:
                fact_check, _sources = self.check_question(current)
            except Exception as e:
                fact_check = {
                    "status": "unresolved",
                    "note": f"Fact-check failed: {e}",
                    "recommended_answer": "",
                    "recommended_answer_text": "",
                    "model": self.model_name,
                    "sources": [],
                }
            current.fact_check = fact_check
            status = fact_check.get("status", "unresolved")
            recommended_answer = str(fact_check.get("recommended_answer", "") or "").upper()
            if status == "disputed":
                if recommended_answer in sanitize_choice_map(current.choices):
                    current.proposed_correct_answer = recommended_answer
                    recommended_text = str(fact_check.get("recommended_answer_text", "") or "").strip()
                    current.proposed_correct_answer_text = (
                        recommended_text or str(current.choices.get(recommended_answer, "")).strip()
                    )
                warning = "Fact-check disputed the keyed answer."
            elif status == "unresolved":
                warning = "Fact-check could not confidently verify this question."
            else:
                warning = ""
            if warning and warning not in current.warnings:
                current.warnings.append(warning)
            if logger:
                logger(json.dumps({"question_id": current.question_id, "fact_check": current.fact_check}))
            checked.append(current)
        return checked
