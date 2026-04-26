"""Repository adapter for pipeline run artifacts."""

from __future__ import annotations

import json
import os
import time
from datetime import datetime
from pathlib import Path
from typing import Any

from domain.models import ExtractedQuestion
from storage.run_state import RunStateUpdate

_MISSING = object()


class RunRepository:
    """Read/write run artifacts through a single storage boundary."""

    def atomic_write_json(
        self,
        path: str | Path,
        data: Any,
        *,
        indent: int | None = 2,
        ensure_ascii: bool = False,
    ) -> Path:
        target = Path(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = target.with_suffix(f"{target.suffix}.tmp.{os.getpid()}.{int(time.time() * 1000)}")
        try:
            with open(tmp_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=indent, ensure_ascii=ensure_ascii)
            os.replace(tmp_path, target)
        finally:
            if tmp_path.exists():
                tmp_path.unlink(missing_ok=True)
        return target

    def write_json(
        self,
        path: str | Path,
        data: Any,
        *,
        pretty: bool = True,
        atomic: bool = False,
        ensure_ascii: bool = False,
    ) -> Path:
        target = Path(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        if atomic:
            return self.atomic_write_json(
                target,
                data,
                indent=(2 if pretty else None),
                ensure_ascii=ensure_ascii,
            )
        with open(target, "w", encoding="utf-8") as f:
            if pretty:
                json.dump(data, f, indent=2, ensure_ascii=ensure_ascii)
            else:
                json.dump(data, f, ensure_ascii=ensure_ascii)
        return target

    def load_json(self, path: str | Path, *, default: Any = _MISSING) -> Any:
        target = Path(path)
        if not target.exists():
            if default is _MISSING:
                raise FileNotFoundError(f"JSON file not found: {target}")
            return default
        with open(target, "r", encoding="utf-8") as f:
            return json.load(f)

    def save_extraction_progress(
        self,
        progress_file: str | Path,
        questions: list[ExtractedQuestion],
        processed_slides: set[int],
        source_pptx: str | Path,
        total_slides: int,
    ) -> Path:
        source_path = Path(source_pptx).resolve()
        source_stat = source_path.stat()
        payload = {
            "timestamp": datetime.now().isoformat(),
            "source_pptx_path": str(source_path),
            "source_size_bytes": source_stat.st_size,
            "source_mtime_ns": source_stat.st_mtime_ns,
            "total_slides": total_slides,
            "processed_slides": list(processed_slides),
            "questions": [q.to_dict() for q in questions],
        }
        return self.atomic_write_json(progress_file, payload)

    def load_extraction_progress(self, progress_file: str | Path) -> dict:
        data = self.load_json(progress_file, default={})
        if isinstance(data, dict):
            return data
        return {}

    def save_run_state(self, path: str | Path, update: RunStateUpdate | dict[str, Any]) -> Path:
        payload = update.to_dict() if isinstance(update, RunStateUpdate) else dict(update)
        if "updated_at" not in payload:
            payload["updated_at"] = datetime.now().isoformat()
        return self.atomic_write_json(path, payload)

    def load_run_state(self, path: str | Path) -> dict:
        data = self.load_json(path, default={})
        if isinstance(data, dict):
            return data
        return {}

    def replace_file(self, src: str | Path, dst: str | Path) -> Path:
        source = Path(src)
        target = Path(dst)
        target.parent.mkdir(parents=True, exist_ok=True)
        os.replace(source, target)
        return target

    def load_extracted_questions(self, json_path: str | Path) -> list[ExtractedQuestion]:
        data = self.load_json(json_path)
        questions = []
        for q_data in data.get("questions", []):
            if isinstance(q_data, dict):
                questions.append(ExtractedQuestion.from_dict(q_data))
        return questions

    def load_usmle_questions(self, json_path: str | Path) -> list[dict[str, Any]]:
        data = self.load_json(json_path, default={})
        questions = data.get("questions", []) if isinstance(data, dict) else []
        return questions if isinstance(questions, list) else []
