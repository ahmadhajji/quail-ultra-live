from __future__ import annotations

from collections import deque
from concurrent.futures import Future

from ai.gemini_processor import ExtractedQuestion
from domain.models import USMLEQuestion
from formatting.scheduler import format_batch_openai_parallel


class _FakeClock:
    def __init__(self) -> None:
        self.now = 0.0
        self.sleeps: list[float] = []

    def time(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.now += seconds


class _ImmediateExecutor:
    def __init__(self, max_workers: int = 1) -> None:
        self.max_workers = max_workers

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def submit(self, fn, *args, **kwargs) -> Future:
        future: Future = Future()
        try:
            result = fn(*args, **kwargs)
        except Exception as e:
            future.set_exception(e)
        else:
            future.set_result(result)
        return future


class _DummyProgress:
    def update(self, _step: int) -> None:
        return None

    def close(self) -> None:
        return None


def _wait_all(futures, timeout=None, return_when=None):
    return set(futures), set()


def _dummy_tqdm(*_args, **_kwargs):
    return _DummyProgress()


def test_openai_scheduler_retry_and_backpressure_is_deterministic_with_fake_clock():
    question = ExtractedQuestion(slide_number=1, question_index=1, question_id="q1")
    attempts = {"q1": 0}
    checkpoints: list[str] = []
    progress_updates: list[tuple[int, int]] = []

    def format_question(q: ExtractedQuestion, question_id: str, retries: int) -> USMLEQuestion:
        attempts[question_id] += 1
        if attempts[question_id] == 1:
            return USMLEQuestion(
                original_slide_number=q.slide_number,
                question_id=question_id,
                error="HTTP 429: rate limit exceeded. retry_after=1.5",
            )
        return USMLEQuestion(
            original_slide_number=q.slide_number,
            question_id=question_id,
            question_stem="ok",
            question="ok",
            choices={"A": "1", "B": "2", "C": "3", "D": "4"},
            correct_answer="A",
            tags={"rotation": "Internal Medicine", "topic": "Cardiology"},
        )

    clock = _FakeClock()
    metrics = {"api_calls": 0, "inflight_current": 0, "last_error_summary": ""}
    results_by_id: dict[str, USMLEQuestion] = {}
    cache_payload = {"entries": {}}

    format_batch_openai_parallel(
        pending_questions=[question],
        results_by_id=results_by_id,
        cache_payload=cache_payload,
        request_starts=deque(),
        checkpoint_every=1,
        save_checkpoint=lambda last_qid="": checkpoints.append(last_qid),
        progress_callback=lambda done, total: progress_updates.append((done, total)),
        progress_total=1,
        metrics=metrics,
        stable_question_id=lambda q: q.question_id,
        question_input_hash=lambda q, qid: f"hash-{qid}",
        format_question=format_question,
        is_rate_limit_error=lambda message: "429" in message,
        extract_retry_after_seconds=lambda message: 1.5 if "retry_after" in message else None,
        short_error=lambda message: message,
        target_rpm=500,
        max_inflight=1,
        model_access_error_cls=RuntimeError,
        time_fn=clock.time,
        sleep_fn=clock.sleep,
        now_iso_fn=lambda: f"t={clock.now:.2f}",
        executor_factory=_ImmediateExecutor,
        wait_fn=_wait_all,
        tqdm_factory=_dummy_tqdm,
    )

    assert attempts["q1"] == 2
    assert metrics["api_calls"] == 2
    assert "q1" in results_by_id
    assert not results_by_id["q1"].error
    assert checkpoints == ["q1"]
    assert progress_updates[-1] == (1, 1)
    assert sum(clock.sleeps) >= 1.5
