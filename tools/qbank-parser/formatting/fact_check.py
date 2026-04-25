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
        cache_path: str | Path | None = None,
    ):
        from openai import OpenAI

        self.model_name = model_name
        self.reasoning_effort = reasoning_effort
        self.web_search_enabled = bool(web_search_enabled)
        self.repo = RunRepository()
        self.cache_path = Path(cache_path) if cache_path else None
        self.adapter = OpenAIFormatterAdapter(
            client=OpenAI(api_key=api_key),
            model_name=model_name,
            reasoning_effort=reasoning_effort,
            web_search_enabled=web_search_enabled,
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
            and isinstance(payload.get("entries"), dict)
        ):
            return payload
        return {
            "version": self.CACHE_VERSION,
            "model_name": self.model_name,
            "reasoning_effort": self.reasoning_effort,
            "web_search_enabled": self.web_search_enabled,
            "entries": {},
        }

    def _save_cache(self) -> None:
        if self.cache_path:
            self.repo.atomic_write_json(self.cache_path, self.cache, indent=2, ensure_ascii=False)

    def _question_input_hash(self, question: ExtractedQuestion) -> str:
        payload = {
            "version": self.CACHE_VERSION,
            "model_name": self.model_name,
            "reasoning_effort": self.reasoning_effort,
            "web_search_enabled": self.web_search_enabled,
            "question_id": question.question_id,
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

    def _build_prompt(self, question: ExtractedQuestion) -> str:
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
        return (
            "You are fact-checking a medical recall question before export.\n"
            "Decide if the currently keyed answer is medically accurate.\n"
            "Use web grounding when available. Respond in JSON only.\n\n"
            f"Rotation: {rotation}\n"
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

        response_text, sources = self.adapter.generate_content(self._build_prompt(question))
        data = parse_json_response(response_text)
        payload = {
            "status": str(data.get("status", "unresolved")).strip() or "unresolved",
            "note": str(data.get("note", "")).strip(),
            "recommended_answer": str(data.get("recommended_answer", "")).strip().upper(),
            "recommended_answer_text": strip_bat_markers(str(data.get("recommended_answer_text", "")).strip()),
            "model": self.model_name,
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
                current.classification = "needs_review"
                current.review_status = "pending"
                warning = "Fact-check disputed the keyed answer."
            elif status == "unresolved":
                current.classification = "needs_review"
                current.review_status = "pending"
                warning = "Fact-check could not confidently verify this question."
            else:
                warning = ""
            if warning and warning not in current.warnings:
                current.warnings.append(warning)
            if logger:
                logger(json.dumps({"question_id": current.question_id, "fact_check": current.fact_check}))
            checked.append(current)
        return checked
