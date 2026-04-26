"""v2 pipeline orchestrator.

Four stages:
1. Raw extraction (no AI): Google Slides → PPTX → per-slide text/notes/highlights/images/screenshot/comments
2. Detection (1 AI call/slide, multimodal): identify question(s) on each slide
3. Rewrite (1 AI call/question, rotation-specific): produce USMLE-style stem/choices/explanation/edu objective (PR 3)
4. Native pack export (no AI): write Quail Ultra native pack (PR 4)

This module currently implements Stages 1 and 2. Stages 3 and 4 land in
PR 3 and PR 4 respectively.
"""

from __future__ import annotations

import hashlib
import json
import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from domain.models import DetectedQuestion, RawSlide, SlideContent
from providers.v2.openai_detect import (
    DEFAULT_DETECT_MODEL,
    DEFAULT_DETECT_REASONING_EFFORT,
    DETECT_PROMPT_VERSION,
    DetectionResult,
    OpenAIDetectAdapter,
)

logger = logging.getLogger(__name__)

MAX_DETECT_INFLIGHT = 8
MAX_COMMENTS_PER_SLIDE = 25


# ---------------------------------------------------------------------------
# Run options + run state
# ---------------------------------------------------------------------------


@dataclass
class V2RunOptions:
    """Configuration for a v2 pipeline run."""

    google_slides_link: str = ""
    google_slides_id: str = ""
    pptx_path: str = ""
    rotation: str = ""
    pack_id: str = "qbank"
    title: str = ""
    output_dir: Path = field(default_factory=lambda: Path("output"))
    api_key: str = ""
    detect_model: str = DEFAULT_DETECT_MODEL
    detect_reasoning_effort: str = DEFAULT_DETECT_REASONING_EFFORT
    max_detect_inflight: int = MAX_DETECT_INFLIGHT
    use_cache: bool = True
    # Optional injected dependencies (for testing).
    parse_pptx_fn: Callable[[str | Path, Path], list[SlideContent]] | None = None
    pptx_to_images_fn: Callable[[str | Path, str | Path, int], list[str]] | None = None
    google_download_fn: Callable[[str, Path], Path] | None = None
    fetch_comments_fn: Callable[[str], Any] | None = None
    detect_adapter: OpenAIDetectAdapter | None = None


@dataclass
class V2RunStats:
    """Cost + usage stats for the run. One JSON line at end of run."""

    ai_calls: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cache_hits: int = 0
    duration_seconds: float = 0.0

    def merge_usage(self, prompt: int, completion: int) -> None:
        self.prompt_tokens += int(prompt or 0)
        self.completion_tokens += int(completion or 0)

    def to_dict(self) -> dict:
        return {
            "ai_calls": self.ai_calls,
            "prompt_tokens": self.prompt_tokens,
            "completion_tokens": self.completion_tokens,
            "cache_hits": self.cache_hits,
            "duration_seconds": round(self.duration_seconds, 2),
        }


# ---------------------------------------------------------------------------
# Stage 1 — Raw extraction
# ---------------------------------------------------------------------------


def stage1_raw_extract(opts: V2RunOptions) -> tuple[list[RawSlide], dict[str, Any]]:
    """Download deck (if needed), parse PPTX, render slide screenshots, fetch + filter comments.

    No AI calls. Idempotent and deterministic.
    Returns the list of RawSlide objects and a metadata dict.
    """
    parse_pptx = opts.parse_pptx_fn
    pptx_to_images = opts.pptx_to_images_fn
    google_download = opts.google_download_fn
    fetch_comments = opts.fetch_comments_fn

    if parse_pptx is None:
        from parsers.pptx_parser import parse_pptx as _parse_pptx

        parse_pptx = _parse_pptx
    if pptx_to_images is None:
        from utils.image_renderer import pptx_to_images as _pptx_to_images

        pptx_to_images = _pptx_to_images

    output_dir = Path(opts.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    media_dir = output_dir / "media"
    media_dir.mkdir(parents=True, exist_ok=True)
    slides_screenshot_dir = output_dir / "slide-screenshots"
    slides_screenshot_dir.mkdir(parents=True, exist_ok=True)

    pptx_path: Path
    deck_id: str

    if opts.google_slides_link or opts.google_slides_id:
        if google_download is None:
            from parsers.google_api import (
                export_presentation_to_pptx,
                extract_presentation_id,
            )

            slides_id = opts.google_slides_id or extract_presentation_id(opts.google_slides_link)
            download_target = output_dir / f"{slides_id}.pptx"
            pptx_path = export_presentation_to_pptx(slides_id, download_target)
            deck_id = slides_id
        else:
            slides_id = opts.google_slides_id or opts.google_slides_link
            download_target = output_dir / f"{slides_id}.pptx"
            pptx_path = google_download(slides_id, download_target)
            deck_id = slides_id
    elif opts.pptx_path:
        pptx_path = Path(opts.pptx_path)
        deck_id = pptx_path.stem
    else:
        raise ValueError("V2RunOptions requires either google_slides_link/id or pptx_path")

    if not pptx_path.exists():
        raise FileNotFoundError(f"PPTX not found at {pptx_path}")

    logger.info("Stage 1: parsing PPTX %s", pptx_path)
    slide_contents: list[SlideContent] = parse_pptx(str(pptx_path), media_dir)

    logger.info("Stage 1: rendering %s slide screenshots", len(slide_contents))
    screenshot_paths: list[str] = pptx_to_images(str(pptx_path), str(slides_screenshot_dir), 150)

    comments_by_slide: dict[int, list[dict]] = {}
    if (opts.google_slides_link or opts.google_slides_id) and fetch_comments is None:
        try:
            from parsers.google_api import (
                extract_presentation_id,
                fetch_comments as _fetch_comments,
                get_comments_by_slide as _get_comments_by_slide,
            )

            slides_id = opts.google_slides_id or extract_presentation_id(opts.google_slides_link)
            raw_comments = _fetch_comments(slides_id)
            grouped = _get_comments_by_slide(raw_comments)
            comments_by_slide = _filter_comments_by_slide(grouped, {s.slide_number for s in slide_contents})
        except Exception as exc:
            logger.warning("Stage 1: failed to fetch comments — continuing without: %s", exc)
            comments_by_slide = {}
    elif fetch_comments is not None:
        try:
            grouped = fetch_comments(opts.google_slides_id or opts.google_slides_link or "")
            if isinstance(grouped, dict):
                comments_by_slide = _filter_comments_by_slide(
                    grouped,
                    {s.slide_number for s in slide_contents},
                )
        except Exception as exc:
            logger.warning("Stage 1: injected fetch_comments failed: %s", exc)

    raw_slides: list[RawSlide] = []
    for slide in slide_contents:
        screenshot_path = ""
        idx = slide.slide_number - 1
        if 0 <= idx < len(screenshot_paths):
            screenshot_path = screenshot_paths[idx]
        slide_comments = _coerce_comments(comments_by_slide.get(slide.slide_number, []))
        raw = RawSlide(
            slide_number=slide.slide_number,
            deck_id=deck_id,
            text_blocks=list(slide.texts),
            speaker_notes=slide.speaker_notes,
            highlighted_texts=list(slide.highlighted_texts),
            potential_correct_answer=slide.potential_correct_answer,
            image_paths=list(slide.images),
            slide_screenshot_path=screenshot_path,
            comments=slide_comments,
        )
        raw_slides.append(raw)

    raw_slides_path = output_dir / "raw_slides.json"
    raw_slides_path.write_text(
        json.dumps([s.to_dict() for s in raw_slides], indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    metadata: dict[str, Any] = {
        "deck_id": deck_id,
        "pptx_path": str(pptx_path),
        "raw_slides_path": str(raw_slides_path),
        "media_dir": str(media_dir),
        "slide_screenshots_dir": str(slides_screenshot_dir),
        "slide_count": len(raw_slides),
    }
    return raw_slides, metadata


def _filter_comments_by_slide(
    comments_by_slide: dict[int, list[Any]],
    selected: set[int],
) -> dict[int, list[dict]]:
    """Keep slide-anchored comments only, cap per-slide volume, normalize to dicts."""
    filtered: dict[int, list[dict]] = {}
    for slide_number, slide_comments in comments_by_slide.items():
        if slide_number == 0 or slide_number not in selected:
            continue
        normalized = _coerce_comments(slide_comments)[:MAX_COMMENTS_PER_SLIDE]
        if normalized:
            filtered[slide_number] = normalized
    return filtered


def _coerce_comments(items: list[Any]) -> list[dict]:
    """Normalize comments to {author, content} dicts."""
    out: list[dict] = []
    for item in items or []:
        if isinstance(item, dict):
            content = str(item.get("content", "")).strip()
            if content:
                out.append({"author": str(item.get("author", "Unknown")), "content": content})
        else:
            content = str(getattr(item, "content", "")).strip()
            if content:
                out.append(
                    {
                        "author": str(getattr(item, "author", "Unknown")),
                        "content": content,
                    }
                )
    return out


# ---------------------------------------------------------------------------
# Stage 2 — Detection
# ---------------------------------------------------------------------------


def stage2_detect(
    raw_slides: list[RawSlide],
    opts: V2RunOptions,
    stats: V2RunStats,
) -> tuple[list[DetectedQuestion], dict[int, str]]:
    """Run Stage 2 detection across all slides in parallel."""
    adapter = opts.detect_adapter or OpenAIDetectAdapter(
        api_key=opts.api_key,
        model_name=opts.detect_model,
        reasoning_effort=opts.detect_reasoning_effort,
    )
    cache_path = Path(opts.output_dir) / "v2_stage2_cache.json"
    cache = _load_cache(cache_path) if opts.use_cache else {}

    detected: list[DetectedQuestion] = []
    errors: dict[int, str] = {}
    cache_writes = 0

    def _process(slide: RawSlide) -> tuple[RawSlide, DetectionResult | None, list[DetectedQuestion]]:
        cache_key = _stage2_cache_key(slide, adapter.model_name, DETECT_PROMPT_VERSION)
        if opts.use_cache and cache_key in cache:
            cached_questions = [DetectedQuestion.from_dict(q) for q in cache[cache_key]]
            return slide, None, cached_questions
        result = adapter.detect(slide)
        return slide, result, result.questions

    with ThreadPoolExecutor(max_workers=opts.max_detect_inflight) as pool:
        futures = {pool.submit(_process, s): s for s in raw_slides}
        for future in as_completed(futures):
            slide = futures[future]
            try:
                processed_slide, result, questions = future.result()
            except Exception as exc:
                errors[slide.slide_number] = str(exc)
                continue

            if result is None:
                # Cache hit
                stats.cache_hits += 1
                detected.extend(questions)
                continue

            stats.ai_calls += 1
            stats.merge_usage(result.usage.prompt_tokens, result.usage.completion_tokens)
            if result.error:
                errors[processed_slide.slide_number] = result.error
                continue
            cache_key = _stage2_cache_key(
                processed_slide, adapter.model_name, DETECT_PROMPT_VERSION
            )
            cache[cache_key] = [q.to_dict() for q in result.questions]
            cache_writes += 1
            detected.extend(result.questions)

    if opts.use_cache and cache_writes > 0:
        _save_cache(cache_path, cache)

    detected.sort(key=lambda q: (q.slide_number, q.question_index))

    detected_path = Path(opts.output_dir) / "detected_questions.json"
    detected_path.write_text(
        json.dumps([q.to_dict() for q in detected], indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    return detected, errors


def _stage2_cache_key(slide: RawSlide, model_name: str, prompt_version: str) -> str:
    payload = f"{slide.content_hash()}|{model_name}|{prompt_version}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _load_cache(path: Path) -> dict[str, list[dict]]:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


def _save_cache(path: Path, cache: dict[str, list[dict]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(cache, indent=2, ensure_ascii=False), encoding="utf-8")


# ---------------------------------------------------------------------------
# Top-level orchestrator (Stages 1 + 2 only — Stage 3 + 4 land in PR 3 + PR 4)
# ---------------------------------------------------------------------------


@dataclass
class V2RunResult:
    """Final output of a v2 run."""

    raw_slides: list[RawSlide]
    detected_questions: list[DetectedQuestion]
    metadata: dict[str, Any]
    stage2_errors: dict[int, str]
    stats: V2RunStats


def run_v2_stages_1_and_2(opts: V2RunOptions) -> V2RunResult:
    """Run Stages 1 and 2 of the v2 pipeline. PRs 3+4 add Stages 3+4."""
    started = time.monotonic()
    stats = V2RunStats()

    raw_slides, metadata = stage1_raw_extract(opts)
    detected, errors = stage2_detect(raw_slides, opts, stats)

    stats.duration_seconds = time.monotonic() - started

    stats_path = Path(opts.output_dir) / "v2_run_stats.json"
    stats_path.write_text(
        json.dumps(stats.to_dict(), indent=2),
        encoding="utf-8",
    )

    return V2RunResult(
        raw_slides=raw_slides,
        detected_questions=detected,
        metadata=metadata,
        stage2_errors=errors,
        stats=stats,
    )
