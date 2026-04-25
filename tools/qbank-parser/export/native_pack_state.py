"""Persistent native pack state for stable Quail Ultra question IDs."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


PACK_STATE_FILE = "pack_state.json"


def _slug(value: str, fallback: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._:-]+", ".", str(value or "").strip())
    cleaned = cleaned.strip(".:-_")
    if not cleaned:
        cleaned = fallback
    if not re.match(r"^[A-Za-z0-9]", cleaned):
        cleaned = f"q{cleaned}"
    return cleaned


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def source_key_for_question(question: dict[str, Any], pack_id: str) -> str:
    """Return the stable source key used to map source slides to question IDs."""
    deck_id = str(question.get("deck_id", "") or question.get("document_id", "") or pack_id)
    slide_number = int(question.get("original_slide_number", question.get("slide_number", 0)) or 0)
    question_index = int(question.get("original_question_index", question.get("question_index", 1)) or 1)
    variant_label = str(question.get("variant_label", "") or "")
    return f"{deck_id}:{slide_number}:{question_index}:{variant_label}"


def proposed_question_id(question: dict[str, Any], pack_id: str) -> str:
    """Generate a readable stable ID for a new source key."""
    deck_id = str(question.get("deck_id", "") or question.get("document_id", "") or pack_id)
    slide_number = int(question.get("original_slide_number", question.get("slide_number", 0)) or 0)
    question_index = int(question.get("original_question_index", question.get("question_index", 1)) or 1)
    variant_label = str(question.get("variant_label", "") or "")
    variant = f".{_slug(variant_label, 'variant')}" if variant_label else ""
    return _slug(
        f"{_slug(pack_id, 'pack')}.{_slug(deck_id, 'deck')}.s{slide_number:03d}.q{question_index:02d}{variant}",
        f"{_slug(pack_id, 'pack')}.q{question_index:03d}",
    )


@dataclass
class NativePackState:
    pack_id: str
    schema_version: int = 1
    questions: dict[str, dict[str, Any]] = field(default_factory=dict)
    history: list[dict[str, Any]] = field(default_factory=list)
    blocked: list[dict[str, Any]] = field(default_factory=list)

    @classmethod
    def load(cls, path: str | Path, *, pack_id: str) -> "NativePackState":
        state_path = Path(path)
        if not state_path.exists():
            return cls(pack_id=pack_id)
        data = json.loads(state_path.read_text(encoding="utf-8"))
        return cls(
            pack_id=str(data.get("packId", pack_id) or pack_id),
            schema_version=int(data.get("schemaVersion", 1) or 1),
            questions=data.get("questions", {}) if isinstance(data.get("questions"), dict) else {},
            history=data.get("history", []) if isinstance(data.get("history"), list) else [],
            blocked=data.get("blocked", []) if isinstance(data.get("blocked"), list) else [],
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "schemaVersion": self.schema_version,
            "packId": self.pack_id,
            "questions": self.questions,
            "history": self.history,
            "blocked": self.blocked,
        }

    def save(self, path: str | Path) -> None:
        Path(path).write_text(json.dumps(self.to_dict(), indent=2, ensure_ascii=False), encoding="utf-8")

    def allocated_ids(self) -> set[str]:
        return {
            str(record.get("questionId", ""))
            for record in self.questions.values()
            if str(record.get("questionId", ""))
        }

    def question_id_for(self, *, source_key: str, question: dict[str, Any]) -> str:
        existing = self.questions.get(source_key)
        if existing and existing.get("questionId"):
            return str(existing["questionId"])

        base = proposed_question_id(question, self.pack_id)
        allocated = self.allocated_ids()
        if base not in allocated:
            return base

        counter = 2
        while f"{base}.{counter}" in allocated:
            counter += 1
        return f"{base}.{counter}"

    def record_decision(
        self,
        *,
        source_key: str,
        question_id: str,
        source_hash: str,
        content_hash: str,
        status: str,
        action: str,
        dedupe_fingerprint: str = "",
        conflict_status: str = "none",
    ) -> None:
        timestamp = _now_iso()
        previous = self.questions.get(source_key, {})
        self.questions[source_key] = {
            "questionId": question_id,
            "lastSourceHash": source_hash,
            "lastContentHash": content_hash,
            "status": status,
            "dedupeFingerprint": dedupe_fingerprint,
            "conflictStatus": conflict_status,
            "updatedAt": timestamp,
        }
        self.history.append(
            {
                "at": timestamp,
                "sourceKey": source_key,
                "questionId": question_id,
                "action": action,
                "previousContentHash": previous.get("lastContentHash", ""),
                "contentHash": content_hash,
                "status": status,
            }
        )

    def record_blocked(self, *, source_key: str, question_id: str, reason: str) -> None:
        self.blocked.append(
            {
                "at": _now_iso(),
                "sourceKey": source_key,
                "questionId": question_id,
                "reason": reason,
            }
        )
