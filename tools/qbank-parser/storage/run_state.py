"""Run-state helpers for durable local resume."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime


RUN_STATE_FILENAME = "run_state.json"
EXTRACT_PARTIAL_FILENAME = "extracted_questions.partial.json"
FORMAT_PARTIAL_FILENAME = "usmle_formatted_questions.partial.json"


@dataclass(frozen=True)
class RunStateUpdate:
    """Payload for a durable run-state checkpoint."""

    provider: str
    stage: str
    source_fingerprint: str
    source_path: str = ""
    source_id: str = ""
    model_name: str = ""
    search_enabled: bool = False
    total_items: int = 0
    completed_items: int = 0
    completed_success: int = 0
    completed_failed: int = 0
    last_completed_id: str = ""
    status: str = "running"
    stop_reason: str = ""
    resume_hint: str = ""

    def to_dict(self) -> dict:
        return {
            "provider": self.provider,
            "stage": self.stage,
            "source_fingerprint": self.source_fingerprint,
            "source_path": self.source_path,
            "source_id": self.source_id,
            "model_name": self.model_name,
            "search_enabled": self.search_enabled,
            "total_items": self.total_items,
            "completed_items": self.completed_items,
            "completed_success": self.completed_success,
            "completed_failed": self.completed_failed,
            "last_completed_id": self.last_completed_id,
            "status": self.status,
            "stop_reason": self.stop_reason,
            "resume_hint": self.resume_hint,
            "updated_at": datetime.now().isoformat(),
        }
