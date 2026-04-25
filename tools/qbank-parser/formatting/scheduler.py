"""Adaptive OpenAI formatter batch scheduler."""

from __future__ import annotations

import time
from collections import deque
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from datetime import datetime
from typing import Any, Callable, Protocol

from tqdm import tqdm

from domain.models import ExtractedQuestion, USMLEQuestion


class ProgressBar(Protocol):
    def update(self, n: int = 1) -> object: ...

    def close(self) -> object: ...


def format_batch_openai_parallel(
    *,
    pending_questions: list[ExtractedQuestion],
    results_by_id: dict[str, USMLEQuestion],
    cache_payload: dict,
    request_starts: deque[float],
    checkpoint_every: int,
    save_checkpoint: Callable[[str], None],
    progress_callback: Callable[[int, int], None] | None,
    progress_total: int,
    metrics: dict,
    stable_question_id: Callable[[ExtractedQuestion], str],
    question_input_hash: Callable[[ExtractedQuestion, str], str],
    format_question: Callable[[ExtractedQuestion, str, int], USMLEQuestion],
    is_rate_limit_error: Callable[[str], bool],
    extract_retry_after_seconds: Callable[[str], float | None],
    short_error: Callable[[str], str],
    target_rpm: int,
    max_inflight: int,
    model_access_error_cls: type[Exception],
    time_fn: Callable[[], float] = time.time,
    sleep_fn: Callable[[float], None] = time.sleep,
    now_iso_fn: Callable[[], str] | None = None,
    executor_factory: Callable[..., ThreadPoolExecutor] = ThreadPoolExecutor,
    wait_fn: Callable[..., tuple] = wait,
    tqdm_factory: Callable[..., ProgressBar] = tqdm,
) -> None:
    """OpenAI parallel path with adaptive backpressure and retry sweep."""

    if now_iso_fn is None:
        now_iso_fn = lambda: datetime.now().isoformat()

    def run_pass(work_items: list[ExtractedQuestion], pass_max_inflight: int) -> list[ExtractedQuestion]:
        if not work_items:
            return []

        pending = deque(work_items)
        by_id = {stable_question_id(question): question for question in work_items}
        retries_left = {stable_question_id(question): 3 for question in work_items}
        pass_failed: list[ExtractedQuestion] = []
        processed_since_checkpoint = 0
        cooldown_until = 0.0
        dynamic_inflight = max(1, pass_max_inflight)

        pbar = tqdm_factory(total=len(work_items), desc="Formatting USMLE questions (OpenAI parallel)")
        cache_entries = cache_payload.setdefault("entries", {})
        if not isinstance(cache_entries, dict):
            cache_entries = {}
            cache_payload["entries"] = cache_entries

        with executor_factory(max_workers=max(1, pass_max_inflight)) as pool:
            inflight: dict[Any, ExtractedQuestion] = {}

            while pending or inflight:
                now = time_fn()
                while request_starts and now - request_starts[0] > 60.0:
                    request_starts.popleft()

                rpm_capacity = max(0, target_rpm - len(request_starts))

                while pending and len(inflight) < dynamic_inflight and rpm_capacity > 0 and now >= cooldown_until:
                    question = pending.popleft()
                    qid = stable_question_id(question)
                    future = pool.submit(format_question, question, qid, 3)
                    inflight[future] = question
                    request_starts.append(time_fn())
                    metrics["api_calls"] += 1
                    metrics["inflight_current"] = len(inflight)
                    rpm_capacity -= 1
                    now = time_fn()

                if not inflight:
                    sleep_fn(0.05)
                    continue

                done, _ = wait_fn(list(inflight.keys()), timeout=0.2, return_when=FIRST_COMPLETED)
                if not done:
                    continue

                for future in done:
                    question = inflight.pop(future)
                    qid = stable_question_id(question)
                    input_hash = question_input_hash(question, qid)
                    metrics["inflight_current"] = len(inflight)

                    try:
                        result = future.result()
                    except model_access_error_cls:
                        raise
                    except Exception as e:
                        result = USMLEQuestion(
                            original_slide_number=question.slide_number,
                            question_id=qid,
                            images=question.images.copy() if question.images else [],
                            explanation_images=question.explanation_images.copy()
                            if question.explanation_images
                            else [],
                            comments=question.comments.copy() if question.comments else [],
                            error=str(e),
                        )

                    if result.error and is_rate_limit_error(result.error):
                        retries_left[qid] = retries_left.get(qid, 0) - 1
                        retry_after = extract_retry_after_seconds(result.error) or 8.0
                        cooldown_until = max(cooldown_until, time_fn() + retry_after)
                        dynamic_inflight = max(5, dynamic_inflight // 2)
                        metrics["last_error_summary"] = short_error(result.error)

                        if retries_left[qid] > 0:
                            pending.append(question)
                            continue

                    if not result.error and time_fn() >= cooldown_until and dynamic_inflight < pass_max_inflight:
                        dynamic_inflight += 1

                    cache_entries[qid] = {
                        "input_hash": input_hash,
                        "result": result.to_dict(),
                        "updated_at": now_iso_fn(),
                    }
                    results_by_id[qid] = result
                    processed_since_checkpoint += 1
                    pbar.update(1)

                    if result.error:
                        pass_failed.append(by_id[qid])
                        metrics["last_error_summary"] = short_error(result.error)

                    if progress_callback:
                        progress_callback(len(results_by_id), progress_total)

                    if processed_since_checkpoint >= checkpoint_every:
                        save_checkpoint(qid)
                        processed_since_checkpoint = 0

            if processed_since_checkpoint > 0:
                save_checkpoint("")

        pbar.close()
        return pass_failed

    failed_first = run_pass(pending_questions, pass_max_inflight=max_inflight)
    if failed_first:
        failed_unique = {stable_question_id(question): question for question in failed_first}
        failed_second = run_pass(list(failed_unique.values()), pass_max_inflight=min(20, max_inflight))
        if failed_second:
            # Ensure latest failures are preserved in results/cache, no extra action needed.
            pass
