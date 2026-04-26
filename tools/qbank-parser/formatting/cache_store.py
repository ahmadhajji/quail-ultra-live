"""Cache/progress helpers for formatter orchestration."""

from __future__ import annotations

from collections import deque
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, cast

from domain.models import ExtractedQuestion, USMLEQuestion


def prepare_cache_state(
    *,
    valid_questions: list[ExtractedQuestion],
    source_label: str,
    cache_file: Path | None,
    logger: Callable[[str], None],
    cache_version: int,
    provider: str,
    model_name: str,
    reasoning_effort: str,
    web_search_enabled: bool,
    source_fingerprint: str,
    stable_question_id: Callable[[ExtractedQuestion], str],
    question_input_hash: Callable[[ExtractedQuestion, str], str],
    load_json_file: Callable[[Path], dict],
) -> tuple[dict, dict[str, USMLEQuestion], int, list[ExtractedQuestion]]:
    cache_payload: dict[str, Any] = {
        "version": cache_version,
        "provider": provider,
        "model_name": model_name,
        "reasoning_effort": reasoning_effort,
        "web_search_enabled": web_search_enabled,
        "source_label": source_label,
        "source_fingerprint": source_fingerprint,
        "updated_at": datetime.now().isoformat(),
        "entries": {},
    }

    if cache_file:
        try:
            existing = load_json_file(cache_file)
            if (
                existing.get("version") == cache_version
                and existing.get("provider") == provider
                and existing.get("model_name") == model_name
                and existing.get("reasoning_effort") == reasoning_effort
                and bool(existing.get("web_search_enabled")) == web_search_enabled
                and existing.get("source_fingerprint") == source_fingerprint
                and isinstance(existing.get("entries"), dict)
            ):
                cache_payload = existing
                cache_entries = cast(dict[str, dict[str, Any]], cache_payload["entries"])
                logger(f"  📦 Loaded formatter cache with {len(cache_entries)} entries from {cache_file}")
            elif existing:
                logger("  ℹ️ Existing formatter cache ignored (provider/model/input changed).")
        except Exception as e:
            logger(f"  ⚠️ Could not load formatter cache: {e}")

    results_by_id: dict[str, USMLEQuestion] = {}
    cache_hits = 0
    pending_questions: list[ExtractedQuestion] = []
    cache_entries = cast(dict[str, dict[str, Any]], cache_payload["entries"])

    for question in valid_questions:
        qid = stable_question_id(question)
        input_hash = question_input_hash(question, qid)
        cached_entry = cache_entries.get(qid, {})
        cached_hash = cached_entry.get("input_hash")
        cached_result_data = cached_entry.get("result", {})
        cached_result = USMLEQuestion.from_dict(cached_result_data) if isinstance(cached_result_data, dict) else None

        if cached_hash == input_hash and cached_result and not cached_result.error:
            results_by_id[qid] = cached_result
            cache_hits += 1
        else:
            pending_questions.append(question)

    return cache_payload, results_by_id, cache_hits, pending_questions


def build_progress_snapshot(
    *,
    cache_version: int,
    provider_name: str,
    model_name: str,
    reasoning_effort: str,
    web_search_enabled: bool,
    source_label: str,
    source_fingerprint: str | None,
    total_questions: int,
    results_by_id: dict[str, USMLEQuestion],
    cache_hits: int,
    metrics: dict,
    request_starts: deque[float],
    now_ts: float,
    updated_at: str,
    last_question_id: str = "",
) -> dict:
    while request_starts and now_ts - request_starts[0] > 60.0:
        request_starts.popleft()

    completed_total = len(results_by_id)
    completed_success = sum(1 for result in results_by_id.values() if not result.error)
    completed_failed = completed_total - completed_success
    rpm_estimate = len(request_starts)

    return {
        "version": cache_version,
        "provider": provider_name,
        "model_name": model_name,
        "reasoning_effort": reasoning_effort,
        "web_search_enabled": web_search_enabled,
        "source_label": source_label,
        "source_fingerprint": source_fingerprint,
        "total_questions": total_questions,
        "completed_total": completed_total,
        "completed_success": completed_success,
        "completed_failed": completed_failed,
        "pending_questions": max(total_questions - completed_total, 0),
        "cache_hits": cache_hits,
        "api_calls": metrics["api_calls"],
        "inflight_current": metrics["inflight_current"],
        "rpm_estimate": rpm_estimate,
        "last_error_summary": metrics["last_error_summary"],
        "last_completed_question_id": last_question_id,
        "updated_at": updated_at,
    }


def save_checkpoint(
    *,
    cache_payload: dict,
    cache_file: Path | None,
    progress_file: Path | None,
    atomic_write_json: Callable[[Path, dict], None],
    progress_snapshot_factory: Callable[[str], dict],
    last_question_id: str = "",
) -> None:
    cache_payload["updated_at"] = datetime.now().isoformat()
    if cache_file:
        atomic_write_json(cache_file, cache_payload)
    if progress_file:
        atomic_write_json(progress_file, progress_snapshot_factory(last_question_id))
