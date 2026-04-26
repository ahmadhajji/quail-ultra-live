"""Workflow orchestration functions shared by CLI and UI entrypoints."""

import json
import os
import shutil
import tempfile
import re
from pathlib import Path
from datetime import datetime
from typing import Any, cast

# Rich for beautiful output
try:
    from rich.console import Console
    from rich.panel import Panel
    from rich.table import Table

    RICH_AVAILABLE = True
except ImportError:
    RICH_AVAILABLE = False
    print("Warning: 'rich' not installed. Install with: pip install rich")

# Local imports
from config import (
    OPENAI_API_KEY,
    OPENAI_EXTRACTION_MODEL,
    FORMATTER_PROVIDER,
    OPENAI_FORMATTER_MODEL,
    OPENAI_REASONING_EFFORT,
    OPENAI_WEB_SEARCH,
    OPENAI_TARGET_RPM,
    OPENAI_MAX_INFLIGHT,
    OPENAI_FACT_CHECK_MODEL,
    OPENAI_FACT_CHECK_REASONING_EFFORT,
    GOOGLE_SLIDES_ID,
    OUTPUT_DIR,
    validate_config,
    print_config_status,
)
from domain.models import ExtractedQuestion
from parsers.pptx_parser import parse_pptx, get_slide_summary
from parsers.google_api import (
    fetch_comments,
    get_comments_by_slide,
    test_google_api_connection,
    extract_presentation_id,
    fetch_presentation_title,
    export_presentation_to_pptx,
)
from ai.openai_processor import OpenAIProcessor, test_openai_connection
from review.terminal_ui import TerminalReviewUI
from export.csv_export import export_to_csv, export_to_json, load_from_json
from export.usmle_formatter import (
    ModelAccessError,
    USMLEFormatter,
    apply_fact_check_and_randomization,
    export_usmle_questions,
    randomize_formatted_questions,
)
from export.quail_export import export_quail_qbank
from ai.rotation_prompts import normalize_rotation_name, CANONICAL_ROTATIONS
from app.extraction_service import ExtractionService, ExtractionServiceDeps
from app.status_service import StatusService, StatusServiceDeps
from storage.run_repository import RunRepository
from storage.run_state import FORMAT_PARTIAL_FILENAME, RUN_STATE_FILENAME, RunStateUpdate
from utils.question_keys import question_key as build_question_key

# Stats for Nerds module
try:
    from stats.collector import init_stats_collector, get_stats_collector, reset_stats_collector
    from stats.report_generator import StatsReportGenerator
    from stats.cumulative import update_cumulative_stats, format_cumulative_report

    STATS_AVAILABLE = True
except ImportError:
    STATS_AVAILABLE = False


console: Any = Console() if RICH_AVAILABLE else None
RUN_REPOSITORY = RunRepository()


SPEED_PROFILES = {
    "quality": {
        "thinking_level": "high",
        "prompt_mode": "standard",
        "min_request_interval": 0.5,
        "default_workers": 1,
        "checkpoint_every": 1,
    },
    "balanced": {
        "thinking_level": "low",
        "prompt_mode": "standard",
        "min_request_interval": 0.0,
        "default_workers": 3,
        "checkpoint_every": 10,
    },
    "fast": {
        "thinking_level": "low",
        "prompt_mode": "fast",
        "min_request_interval": 0.0,
        "default_workers": 5,
        "checkpoint_every": 20,
    },
}


def get_speed_profile_config(speed_profile: str) -> dict:
    """Resolve speed profile config with safe defaults."""
    return SPEED_PROFILES.get(speed_profile, SPEED_PROFILES["balanced"]).copy()


def question_sort_key(question: ExtractedQuestion) -> tuple:
    """Stable ordering for extracted questions."""
    return (question.slide_number, question.question_index, question.question_id)


def question_key(slide_number: int, question_index: int = 1, question_id: str = "") -> str:
    """Return a stable per-question key."""
    return build_question_key(
        slide_number=slide_number,
        question_index=question_index,
        question_id=question_id,
    )


def slugify_identifier(value: str, fallback: str = "deck") -> str:
    """Create a stable slug for ID prefixing."""
    slug = re.sub(r"[^a-z0-9]+", "-", (value or "").strip().lower()).strip("-")
    return slug or fallback


def infer_rotation_from_title(title: str) -> str:
    """
    Infer a canonical rotation from presentation title.

    Raises:
        ValueError: if no deterministic match can be made.
    """
    normalized = (title or "").strip().lower()
    keyword_map = {
        "Internal Medicine": [
            "internal medicine",
            "medicine i",
            "medicine 1",
            "medicine",
        ],
        "General Surgery": [
            "general surgery",
            "surgery i",
            "surgery 1",
            "surgery",
        ],
        "OB-GYN": [
            "ob-gyn",
            "obgyn",
            "ob gyn",
            "obstetrics",
            "gynecology",
            "gynaecology",
        ],
        "Pediatrics": [
            "pediatrics",
            "paediatrics",
            "peds",
        ],
    }

    scores: dict[str, int] = {}
    for rotation, keywords in keyword_map.items():
        scores[rotation] = sum(1 for k in keywords if k in normalized)

    top_score = max(scores.values()) if scores else 0
    if top_score == 0:
        raise ValueError(
            f"Unable to infer rotation from title: {title!r}. "
            f"Pass explicit --rotations using: {', '.join(CANONICAL_ROTATIONS)}"
        )

    winners = [rotation for rotation, score in scores.items() if score == top_score]
    if len(winners) != 1:
        raise ValueError(f"Ambiguous rotation inference for title: {title!r} -> {winners}. Pass explicit --rotations.")
    return winners[0]


def save_progress(
    progress_file: Path,
    questions: list[ExtractedQuestion],
    processed_slides: set[int],
    source_pptx: Path,
    total_slides: int,
):
    """Save extraction progress to file for resume support."""
    RUN_REPOSITORY.save_extraction_progress(
        progress_file=progress_file,
        questions=questions,
        processed_slides=processed_slides,
        source_pptx=source_pptx,
        total_slides=total_slides,
    )


def is_progress_compatible(progress_data: dict, source_pptx: Path, total_slides: int) -> bool:
    """Return True if progress metadata belongs to the same presentation snapshot."""
    resolved_source = source_pptx.resolve()
    expected_source = str(resolved_source)
    source_stat = source_pptx.stat()

    if progress_data.get("total_slides") != total_slides:
        return False
    # Strict match: same path + same mtime.
    if (
        progress_data.get("source_pptx_path") == expected_source
        and progress_data.get("source_mtime_ns") == source_stat.st_mtime_ns
        and progress_data.get("source_size_bytes") == source_stat.st_size
    ):
        return True

    return False


def print_banner():
    """Print the application banner."""
    if console:
        console.print(
            Panel.fit(
                "[bold blue]QBank Parser[/bold blue]\n[dim]Google Slides → USMLE Questions[/dim]", border_style="blue"
            )
        )
    else:
        print("=" * 40)
        print("QBank Parser")
        print("Google Slides → USMLE Questions")
        print("=" * 40)


def check_status():
    """Check and display current configuration and progress."""
    deps = StatusServiceDeps(
        console=console,
        print_banner=print_banner,
        print_config_status=print_config_status,
        test_openai_connection=test_openai_connection,
        openai_api_key=OPENAI_API_KEY,
        openai_extraction_model=OPENAI_EXTRACTION_MODEL,
        output_dir=OUTPUT_DIR,
        table_cls=Table if RICH_AVAILABLE else None,
    )
    StatusService(deps).run()


def parse_presentation(
    pptx_path: str,
    use_ai: bool = True,
    use_google_api: bool = False,
    google_slides_id: str | None = None,
    generate_stats: bool = False,
    speed_profile: str = "balanced",
    ai_workers: int | None = None,
    checkpoint_every: int | None = None,
    slide_range: tuple[int, int] | None = None,
    max_slides: int | None = None,
    max_questions: int | None = None,
    reprocess_slide: int | None = None,
):
    """
    Parse a PowerPoint presentation and extract questions.

    Args:
        pptx_path: Path to .pptx file
        use_ai: Whether to use AI extraction (OpenAI)
        use_google_api: Whether to fetch comments from Google API
        google_slides_id: Optional Google Slides ID override (falls back to config/.env)
        generate_stats: Whether to generate stats report
        speed_profile: Speed/quality mode ("quality", "balanced", "fast")
        ai_workers: Number of parallel workers for AI extraction
        checkpoint_every: Save progress every N processed slides
        slide_range: Inclusive slide range to process before AI calls
        max_slides: Hard cap on parsed slides before AI calls
        max_questions: Hard cap on extracted question records where practical
        reprocess_slide: Single slide number to process
    """
    deps = ExtractionServiceDeps(
        console=console,
        print_banner=print_banner,
        parse_pptx=parse_pptx,
        fetch_comments=fetch_comments,
        get_comments_by_slide=get_comments_by_slide,
        openai_processor_cls=OpenAIProcessor,
        export_to_json=export_to_json,
        export_to_csv=export_to_csv,
        save_progress=save_progress,
        is_progress_compatible=is_progress_compatible,
        get_speed_profile_config=get_speed_profile_config,
        question_sort_key=question_sort_key,
        output_dir=OUTPUT_DIR,
        openai_api_key=OPENAI_API_KEY,
        openai_extraction_model=OPENAI_EXTRACTION_MODEL,
        google_slides_id=GOOGLE_SLIDES_ID,
        stats_available=STATS_AVAILABLE,
        run_repository=RUN_REPOSITORY,
        init_stats_collector=globals().get("init_stats_collector"),
        stats_report_generator_cls=globals().get("StatsReportGenerator"),
        update_cumulative_stats=globals().get("update_cumulative_stats"),
        reset_stats_collector=globals().get("reset_stats_collector"),
    )
    service = ExtractionService(deps)
    if os.getenv("QBANK_USE_LEGACY_EXTRACT_PATH", "").strip().lower() in {"1", "true", "yes"}:
        return service.run_parse_presentation_legacy(
            pptx_path=pptx_path,
            use_ai=use_ai,
            use_google_api=use_google_api,
            google_slides_id=google_slides_id,
            generate_stats=generate_stats,
            speed_profile=speed_profile,
            ai_workers=ai_workers,
            checkpoint_every=checkpoint_every,
            slide_range=slide_range,
            max_slides=max_slides,
            max_questions=max_questions,
            reprocess_slide=reprocess_slide,
        )
    return service.run_parse_presentation(
        pptx_path=pptx_path,
        use_ai=use_ai,
        use_google_api=use_google_api,
        google_slides_id=google_slides_id,
        generate_stats=generate_stats,
        speed_profile=speed_profile,
        ai_workers=ai_workers,
        checkpoint_every=checkpoint_every,
        slide_range=slide_range,
        max_slides=max_slides,
        max_questions=max_questions,
        reprocess_slide=reprocess_slide,
    )


def review_questions():
    """Run the interactive review session."""
    print_banner()

    extracted_json = OUTPUT_DIR / "extracted_questions.json"

    if not extracted_json.exists():
        console.print("[red]Error: No extracted questions found.[/red]")
        console.print("Run extraction first: python main.py <file.pptx>")
        return

    # Load questions
    questions = load_from_json(extracted_json)
    reviewable_questions = [q for q in questions if q.is_reviewable()]

    console.print(f"\n[bold]Loaded {len(reviewable_questions)} questions for review[/bold]\n")

    # Run review UI
    ui = TerminalReviewUI()

    def save_progress(results):
        """Save after each review."""
        export_to_json(questions, OUTPUT_DIR / "reviewed_questions.json", results)

    results = ui.run_review(reviewable_questions, save_callback=save_progress)

    # Final save with all results
    export_to_json(questions, OUTPUT_DIR / "reviewed_questions.json", results)

    approved = sum(1 for r in results if r.status in {"approved", "edited", "rekeyed"})
    console.print(f"\n[bold green]Review complete![/bold green]")
    console.print(f"  {approved} questions approved for formatting")
    console.print(f"\nNext: [cyan]python main.py --format-usmle[/cyan]")


def archive_formatter_state(active_provider: str) -> Path | None:
    """Archive current formatter state files to a timestamped backup folder."""
    candidates = [
        OUTPUT_DIR / "usmle_formatter_cache.json",
        OUTPUT_DIR / "usmle_formatter_progress.json",
        OUTPUT_DIR / "usmle_formatted_questions.json",
        OUTPUT_DIR / "usmle_formatted_questions.md",
    ]
    existing = [p for p in candidates if p.exists()]
    if not existing:
        return None

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_dir = OUTPUT_DIR / "formatter_backups" / timestamp
    backup_dir.mkdir(parents=True, exist_ok=True)

    moved = []
    for src in existing:
        dest = backup_dir / src.name
        shutil.move(str(src), str(dest))
        moved.append({"source": str(src), "backup": str(dest)})

    manifest = {
        "timestamp": datetime.now().isoformat(),
        "provider": active_provider,
        "moved_file_count": len(moved),
        "source_filenames": [Path(item["source"]).name for item in moved],
        "moved_files": moved,
    }
    with open(backup_dir / "backup_manifest.json", "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
    return backup_dir


def _formatter_partial_checkpoint(
    *,
    results_by_id: dict,
    valid_questions: list[ExtractedQuestion],
    provider: str,
    model_name: str,
    source_label: str,
    source_fingerprint: str,
    search_enabled: bool,
    last_question_id: str,
    status: str,
    stop_reason: str = "",
) -> None:
    ordered_results = [
        results_by_id[
            q.question_id or (f"{q.slide_number}.{q.question_index}" if q.question_index > 1 else str(q.slide_number))
        ]
        for q in valid_questions
        if (q.question_id or (f"{q.slide_number}.{q.question_index}" if q.question_index > 1 else str(q.slide_number)))
        in results_by_id
    ]
    export_usmle_questions(
        ordered_results,
        OUTPUT_DIR / FORMAT_PARTIAL_FILENAME,
        "json",
        model_used=model_name,
        provider_used=provider,
    )
    RUN_REPOSITORY.save_run_state(
        OUTPUT_DIR / RUN_STATE_FILENAME,
        RunStateUpdate(
            provider=provider,
            stage="format",
            source_fingerprint=source_fingerprint,
            source_path=source_label,
            model_name=model_name,
            search_enabled=search_enabled,
            total_items=len(valid_questions),
            completed_items=len(results_by_id),
            completed_success=sum(1 for result in results_by_id.values() if not result.error),
            completed_failed=sum(1 for result in results_by_id.values() if result.error),
            last_completed_id=last_question_id,
            status=status,
            stop_reason=stop_reason,
            resume_hint="python main.py --format-usmle",
        ),
    )


def _finalize_format_stats(source_label: str) -> None:
    if not STATS_AVAILABLE:
        return
    stats_collector = get_stats_collector()
    if not stats_collector:
        return
    try:
        summary = stats_collector.finalize()
        report_gen = StatsReportGenerator()
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        report_path = OUTPUT_DIR / f"stats_report_format_{timestamp}.html"
        report_gen.generate_html(summary, report_path)
        json_path = OUTPUT_DIR / f"stats_report_format_{timestamp}.json"
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(summary, f, indent=2)
        console.print(f"\n[bold magenta]📊 Format Cost Report:[/bold magenta] {json_path}")
        console.print(f"   • AI calls: {summary['ai_summary']['total_calls']}")
        console.print(f"   • Web search calls: {summary['ai_summary']['total_web_search_calls']}")
        console.print(f"   • Estimated cost: ${summary['cost_estimate']['total_cost_usd']:.4f}")
        if update_cumulative_stats:
            update_cumulative_stats(summary)
    except Exception as e:
        console.print(f"[yellow]⚠️ Could not generate format stats report for {source_label}: {e}[/yellow]")
    finally:
        reset_stats_collector()


def format_questions_to_usmle_outputs(
    questions: list[ExtractedQuestion],
    source_file: Path | None = None,
    formatter_provider: str = FORMATTER_PROVIDER,
    openai_model: str = OPENAI_FORMATTER_MODEL,
    openai_reasoning_effort: str = OPENAI_REASONING_EFFORT,
    openai_web_search: bool = OPENAI_WEB_SEARCH,
    openai_target_rpm: int = OPENAI_TARGET_RPM,
    openai_max_inflight: int = OPENAI_MAX_INFLIGHT,
    archive_current_format_state: bool = False,
) -> tuple[Path, Path, None]:
    """Format extracted questions and export JSON/Markdown outputs."""
    provider = (formatter_provider or "openai").strip().lower()
    if provider != "openai":
        raise RuntimeError("Gemini formatter is deprecated in this workspace. Use --formatter-provider openai.")

    if not OPENAI_API_KEY or OPENAI_API_KEY == "your_openai_api_key_here":
        raise RuntimeError("OPENAI_API_KEY not configured")
    api_key = OPENAI_API_KEY
    model_name = openai_model
    reasoning_effort = openai_reasoning_effort
    web_search_enabled = bool(openai_web_search)
    target_rpm = max(1, int(openai_target_rpm))
    max_inflight = max(1, int(openai_max_inflight))

    if archive_current_format_state:
        archived_to = archive_formatter_state(active_provider=provider)
        if archived_to:
            console.print(f"[dim]Archived previous formatter state to:[/dim] {archived_to}")

    formatter = USMLEFormatter(
        api_key=api_key,
        model_name=model_name,
        provider=provider,
        reasoning_effort=reasoning_effort,
        web_search_enabled=web_search_enabled,
        target_rpm=target_rpm,
        max_inflight=max_inflight,
        transport="sdk",
    )

    formatter_cache_path = OUTPUT_DIR / "usmle_formatter_cache.json"
    formatter_progress_path = OUTPUT_DIR / "usmle_formatter_progress.json"
    source_label = str(source_file.resolve()) if source_file else "in-memory"
    if STATS_AVAILABLE and not get_stats_collector():
        stats_collector = init_stats_collector(enabled=True)
        stats_collector.start(source_label)
    valid_questions = [q for q in questions if q.is_exportable_for_formatting()]
    if not valid_questions:
        raise RuntimeError("No approved questions available for formatting")
    _, preview_results, _, _ = formatter._prepare_cache_state(
        valid_questions=valid_questions,
        source_label=source_label,
        cache_file=formatter_cache_path,
        logger=(lambda _msg: None),
    )
    latest_checkpoint: dict[str, object] = {
        "results_by_id": dict(preview_results),
        "last_question_id": "",
        "source_fingerprint": formatter._source_fingerprint(valid_questions),
    }

    def checkpoint_callback(
        last_question_id: str, results_by_id: dict, checkpoint_questions: list[ExtractedQuestion], cache_payload: dict
    ):
        latest_checkpoint["results_by_id"] = dict(results_by_id)
        latest_checkpoint["last_question_id"] = last_question_id
        latest_checkpoint["source_fingerprint"] = (
            cache_payload.get("source_fingerprint") or latest_checkpoint["source_fingerprint"]
        )
        _formatter_partial_checkpoint(
            results_by_id=results_by_id,
            valid_questions=checkpoint_questions,
            provider=provider,
            model_name=formatter.model_name,
            source_label=source_label,
            source_fingerprint=str(latest_checkpoint["source_fingerprint"]),
            search_enabled=web_search_enabled,
            last_question_id=last_question_id,
            status="running",
        )

    try:
        usmle_questions = formatter.format_batch(
            valid_questions,
            checkpoint_every=1,
            cache_path=formatter_cache_path,
            progress_path=formatter_progress_path,
            source_label=source_label,
            logger=(console.print if console else print),
            checkpoint_callback=checkpoint_callback,
        )
    except ModelAccessError as e:
        _formatter_partial_checkpoint(
            results_by_id=dict(cast(dict, latest_checkpoint["results_by_id"])),
            valid_questions=valid_questions,
            provider=provider,
            model_name=formatter.model_name,
            source_label=source_label,
            source_fingerprint=str(latest_checkpoint["source_fingerprint"]),
            search_enabled=web_search_enabled,
            last_question_id=str(latest_checkpoint["last_question_id"]),
            status="failed",
            stop_reason=str(e),
        )
        raise RuntimeError(
            f"Model access failed for provider={provider}, model={model_name}. "
            "No automatic fallback is enabled. "
            f"Details: {e}"
        ) from e
    except Exception:
        _formatter_partial_checkpoint(
            results_by_id=dict(cast(dict, latest_checkpoint["results_by_id"])),
            valid_questions=valid_questions,
            provider=provider,
            model_name=formatter.model_name,
            source_label=source_label,
            source_fingerprint=str(latest_checkpoint["source_fingerprint"]),
            search_enabled=web_search_enabled,
            last_question_id=str(latest_checkpoint["last_question_id"]),
            status="failed",
        )
        raise

    success_count = sum(1 for q in usmle_questions if not q.error)
    usmle_questions = randomize_formatted_questions(usmle_questions)
    failed_questions = [
        {
            "question_id": q.question_id,
            "original_slide_number": q.original_slide_number,
            "error": q.error,
        }
        for q in usmle_questions
        if q.error
    ]
    failed_count = len(failed_questions)
    console.print(f"\n  ✅ Formatted {success_count}/{len(valid_questions)} exportable questions")

    json_path = export_usmle_questions(
        usmle_questions,
        OUTPUT_DIR / "usmle_formatted_questions.json",
        "json",
        model_used=formatter.model_name,
        provider_used=provider,
    )
    md_path = export_usmle_questions(
        usmle_questions,
        OUTPUT_DIR / "usmle_formatted_questions.md",
        "markdown",
        model_used=formatter.model_name,
        provider_used=provider,
    )

    console.print(f"\n[green]JSON saved to:[/green] {json_path}")
    console.print(f"[green]Markdown saved to:[/green] {md_path}")
    _finalize_format_stats(source_label)

    failed_path = OUTPUT_DIR / "usmle_failed_questions.json"
    if failed_count:
        _formatter_partial_checkpoint(
            results_by_id={q.question_id: q for q in usmle_questions},
            valid_questions=valid_questions,
            provider=provider,
            model_name=formatter.model_name,
            source_label=source_label,
            source_fingerprint=str(latest_checkpoint["source_fingerprint"]),
            search_enabled=web_search_enabled,
            last_question_id=str(latest_checkpoint["last_question_id"]),
            status="failed",
            stop_reason=f"{failed_count} questions failed during formatting",
        )
        with open(failed_path, "w", encoding="utf-8") as f:
            json.dump(
                {
                    "total_failed": failed_count,
                    "provider_used": provider,
                    "model_used": formatter.model_name,
                    "failed_questions": failed_questions,
                },
                f,
                indent=2,
                ensure_ascii=False,
            )
        raise RuntimeError(
            f"{failed_count} questions failed during formatting. Partial outputs saved; see {failed_path}"
        )
    elif failed_path.exists():
        failed_path.unlink(missing_ok=True)

    partial_output_path = OUTPUT_DIR / FORMAT_PARTIAL_FILENAME
    if partial_output_path.exists():
        partial_output_path.unlink()
    RUN_REPOSITORY.save_run_state(
        OUTPUT_DIR / RUN_STATE_FILENAME,
        RunStateUpdate(
            provider=provider,
            stage="format",
            source_fingerprint=str(latest_checkpoint["source_fingerprint"]),
            source_path=source_label,
            model_name=formatter.model_name,
            search_enabled=web_search_enabled,
            total_items=len(valid_questions),
            completed_items=len(usmle_questions),
            completed_success=success_count,
            completed_failed=failed_count,
            last_completed_id=str(latest_checkpoint["last_question_id"]),
            status="completed",
            resume_hint="python main.py --format-usmle",
        ),
    )

    return json_path, md_path, None


def format_usmle(
    formatter_provider: str = FORMATTER_PROVIDER,
    openai_model: str = OPENAI_FORMATTER_MODEL,
    openai_reasoning_effort: str = OPENAI_REASONING_EFFORT,
    openai_web_search: bool = OPENAI_WEB_SEARCH,
    openai_target_rpm: int = OPENAI_TARGET_RPM,
    openai_max_inflight: int = OPENAI_MAX_INFLIGHT,
    archive_current_format_state: bool = False,
):
    """Format reviewed questions as USMLE-style vignettes."""
    print_banner()

    # Try reviewed questions first, then extracted
    reviewed_json = OUTPUT_DIR / "reviewed_questions.json"
    extracted_json = OUTPUT_DIR / "extracted_questions.json"

    if reviewed_json.exists():
        source_file = reviewed_json
        console.print("[bold]Using reviewed questions[/bold]")
    elif extracted_json.exists():
        source_file = extracted_json
        console.print("[bold]Using extracted questions (no review done)[/bold]")
    else:
        console.print("[red]Error: No questions found.[/red]")
        console.print("Run extraction first: python main.py <file.pptx>")
        return False

    # Load questions
    questions = load_from_json(source_file)

    # Filter to non-rejected items if we have review data
    if reviewed_json.exists():
        with open(reviewed_json) as f:
            data = json.load(f)

        included_question_keys = set()
        for q in data.get("questions", []):
            if q.get("review_status") not in ("rejected", "skipped", "quit"):
                included_question_keys.add(
                    question_key(
                        slide_number=q.get("slide_number", 0),
                        question_index=q.get("question_index", 1),
                        question_id=q.get("question_id", ""),
                    )
                )

        questions = [
            q
            for q in questions
            if question_key(q.slide_number, q.question_index, q.question_id) in included_question_keys
        ]

    questions = [q for q in questions if q.is_exportable_for_formatting()]

    if not questions:
        console.print("[yellow]No exportable questions to format.[/yellow]")
        return False

    console.print(f"\n[bold]Formatting {len(questions)} exportable questions as USMLE vignettes...[/bold]\n")
    try:
        if STATS_AVAILABLE:
            stats_collector = init_stats_collector(enabled=True)
            stats_collector.start(str(source_file))
        reviewed_or_extracted_questions = load_from_json(source_file)
        keyed_questions = {
            question_key(q.slide_number, q.question_index, q.question_id): q for q in reviewed_or_extracted_questions
        }
        fact_check_candidates = [
            q
            for q in reviewed_or_extracted_questions
            if q.classification not in {"rejected", "error"} and q.review_status not in {"rejected", "skipped", "quit"}
        ]
        checked_questions = apply_fact_check_and_randomization(
            fact_check_candidates,
            api_key=OPENAI_API_KEY,
            model_name=openai_model,
            reasoning_effort=openai_reasoning_effort,
            web_search_enabled=openai_web_search,
        )
        for question_item in checked_questions:
            keyed_questions[
                question_key(question_item.slide_number, question_item.question_index, question_item.question_id)
            ] = question_item
        export_to_json(list(keyed_questions.values()), source_file)
        questions = [q for q in checked_questions if q.is_exportable_for_formatting()]
        if not questions:
            console.print("[yellow]No exportable questions remained after fact-check.[/yellow]")
            return False
        selected_question_slides = len(
            {q.slide_number for q in reviewed_or_extracted_questions if q.classification != "error"}
        )
        error_count = sum(1 for q in reviewed_or_extracted_questions if q.classification == "error")
        disputed_count = sum(
            1 for q in checked_questions if isinstance(q.fact_check, dict) and q.fact_check.get("status") == "disputed"
        )
        unresolved_count = sum(
            1
            for q in checked_questions
            if isinstance(q.fact_check, dict) and q.fact_check.get("status") == "unresolved"
        )
        console.print(
            "[dim]Format yield:[/dim] "
            f"{len(questions)} exportable / {selected_question_slides} question slides; "
            f"{error_count} errors, {disputed_count} disputed, {unresolved_count} unresolved"
        )
        if selected_question_slides and len(questions) < selected_question_slides * 0.85:
            console.print(
                "[yellow]⚠️ Exportable question yield is below 85% of detected question slides; inspect exclusions before a full run.[/yellow]"
            )
        format_questions_to_usmle_outputs(
            questions,
            source_file=source_file,
            formatter_provider=formatter_provider,
            openai_model=openai_model,
            openai_reasoning_effort=openai_reasoning_effort,
            openai_web_search=openai_web_search,
            openai_target_rpm=openai_target_rpm,
            openai_max_inflight=openai_max_inflight,
            archive_current_format_state=archive_current_format_state,
        )
    except Exception as e:
        console.print(f"[red]USMLE formatting failed:[/red] {e}")
        return False

    console.print("\n[bold green]✅ USMLE formatting complete![/bold green]")
    return True


def run_two_sequential(
    inputs: list[str],
    rotations: list[str] | None,
    speed_profile: str,
    ai_workers: int | None,
    checkpoint_every: int | None,
    use_google_api: bool,
    quail_output_dir: str | None,
    quail_images_dir: str | None,
    quail_append: bool,
    formatter_provider: str,
    openai_model: str,
    openai_reasoning_effort: str,
    openai_web_search: bool,
    openai_target_rpm: int,
    openai_max_inflight: int,
    archive_current_format_state: bool,
):
    """Run end-to-end workflow for exactly two Google Slides files."""
    print_banner()
    if not OPENAI_API_KEY or OPENAI_API_KEY == "your_openai_api_key_here":
        console.print("[red]Error:[/red] OPENAI_API_KEY not configured (required for extraction and formatting)")
        return False

    active_provider = (formatter_provider or FORMATTER_PROVIDER).strip().lower()
    if active_provider != "openai":
        console.print("[red]Error:[/red] Gemini formatter is deprecated. Use --formatter-provider openai")
        return False

    if len(inputs) != 2:
        console.print("[red]Error:[/red] --run-two-sequential requires exactly 2 inputs")
        return False

    explicit_rotations = rotations or []
    if explicit_rotations and len(explicit_rotations) != 2:
        console.print("[red]Error:[/red] --rotations must provide exactly 2 rotation values")
        return False

    merged_questions: list[ExtractedQuestion] = []
    temp_root = OUTPUT_DIR / "_slides_tmp"
    temp_root.mkdir(parents=True, exist_ok=True)

    try:
        with tempfile.TemporaryDirectory(dir=temp_root, prefix="batch_") as tmp_dir_str:
            tmp_dir = Path(tmp_dir_str)
            for index, raw_input in enumerate(inputs):
                console.print(f"\n[bold cyan]Batch input {index + 1}/2[/bold cyan]")
                try:
                    presentation_id = extract_presentation_id(raw_input)
                except ValueError as e:
                    console.print(f"[red]Error:[/red] {e}")
                    return False

                title = presentation_id
                title_fetch_error = None
                try:
                    title = fetch_presentation_title(presentation_id)
                except Exception as e:
                    title_fetch_error = e

                if explicit_rotations:
                    try:
                        rotation = normalize_rotation_name(explicit_rotations[index])
                    except ValueError as e:
                        console.print(f"[red]Invalid rotation override:[/red] {e}")
                        return False
                    if title_fetch_error:
                        console.print(
                            f"  [yellow]⚠️ Could not fetch title; continuing with explicit rotation override:[/yellow] {title_fetch_error}"
                        )
                else:
                    if title_fetch_error:
                        console.print(f"[red]Error fetching presentation title:[/red] {title_fetch_error}")
                        return False
                    try:
                        rotation = infer_rotation_from_title(title)
                    except ValueError as e:
                        console.print(f"[red]Rotation inference failed:[/red] {e}")
                        return False

                deck_slug = slugify_identifier(title, fallback=f"deck-{index + 1}")
                pptx_path = tmp_dir / f"{deck_slug}.pptx"
                console.print(f"  • Slides title: [bold]{title}[/bold]")
                console.print(f"  • Rotation: [bold]{rotation}[/bold]")

                try:
                    export_presentation_to_pptx(presentation_id, pptx_path)
                except Exception as e:
                    console.print(f"[red]Failed to export Slides to PPTX:[/red] {e}")
                    return False

                success = parse_presentation(
                    str(pptx_path),
                    use_ai=True,
                    use_google_api=use_google_api,
                    google_slides_id=presentation_id,
                    generate_stats=True,
                    speed_profile=speed_profile,
                    ai_workers=ai_workers,
                    checkpoint_every=checkpoint_every,
                )
                if not success:
                    console.print("[red]Extraction failed; stopping batch run.[/red]")
                    return False

                extracted_path = OUTPUT_DIR / "extracted_questions.json"
                try:
                    deck_questions = RUN_REPOSITORY.load_extracted_questions(extracted_path)
                except FileNotFoundError:
                    console.print("[red]Extraction output missing after run.[/red]")
                    return False
                deck_questions.sort(key=question_sort_key)
                for q in deck_questions:
                    base_id = q.question_id or question_key(q.slide_number, q.question_index, q.question_id)
                    q.question_id = f"{deck_slug}-{base_id}"
                    q.rotation = rotation
                merged_questions.extend(deck_questions)
                console.print(f"  ✅ Merged {len(deck_questions)} extracted questions from this deck")
    finally:
        # Keep temp root for troubleshooting if it contains residual files.
        pass

    if not merged_questions:
        console.print("[yellow]No questions were extracted from either deck.[/yellow]")
        return False

    merged_questions.sort(key=question_sort_key)
    export_to_json(merged_questions, OUTPUT_DIR / "extracted_questions.json")
    export_to_csv(merged_questions, OUTPUT_DIR / "extracted_questions.csv")
    valid_questions = [q for q in merged_questions if q.is_exportable_for_formatting()]

    if not valid_questions:
        console.print("[yellow]No exportable questions to format after merge.[/yellow]")
        return False

    console.print(f"\n[bold]Formatting merged set ({len(valid_questions)} exportable questions)...[/bold]")
    try:
        json_path, _, _ = format_questions_to_usmle_outputs(
            valid_questions,
            source_file=OUTPUT_DIR / "extracted_questions.json",
            formatter_provider=active_provider,
            openai_model=openai_model,
            openai_reasoning_effort=openai_reasoning_effort,
            openai_web_search=openai_web_search,
            openai_target_rpm=openai_target_rpm,
            openai_max_inflight=openai_max_inflight,
            archive_current_format_state=archive_current_format_state,
        )
    except Exception as e:
        console.print(f"[red]USMLE formatting failed:[/red] {e}")
        return False

    output_path = Path(quail_output_dir) if quail_output_dir else (OUTPUT_DIR / "quail_qbank")
    images_path = Path(quail_images_dir) if quail_images_dir else None
    summary = export_quail_qbank(
        source_json=json_path,
        output_dir=output_path,
        images_dir=images_path,
        append=quail_append,
        logger=(console.print if console else print),
    )

    console.print("\n[bold green]✅ Two-file sequential pipeline complete![/bold green]")
    console.print(f"  Questions merged: {len(merged_questions)}")
    console.print(f"  Quail total questions: {summary.total_questions}")
    console.print(f"  Quail output: {summary.output_dir}")
    return True


def export_quail(
    source_json: str | None,
    output_dir: str | None,
    images_dir: str | None,
    append: bool = False,
):
    """Export USMLE JSON into a Quail question bank."""
    print_banner()

    if source_json:
        source_path = Path(source_json)
    else:
        source_path = OUTPUT_DIR / "usmle_formatted_questions.json"

    if output_dir:
        output_path = Path(output_dir)
    else:
        output_path = OUTPUT_DIR / "quail_qbank"

    images_path = Path(images_dir) if images_dir else None

    logger = console.print if console else print

    try:
        summary = export_quail_qbank(
            source_json=source_path,
            output_dir=output_path,
            images_dir=images_path,
            append=append,
            logger=logger,
        )
    except FileNotFoundError as e:
        console.print(f"[red]Error:[/red] {e}")
        if not source_json:
            console.print(
                "[dim]Tip: run `python main.py --format-usmle` first "
                "or pass `--quail-source-json /path/to/file.json`.[/dim]"
            )
        return False, None
    except Exception as e:
        console.print(f"[red]Quail export failed:[/red] {e}")
        return False, None

    console.print("\n[bold green]✅ Quail export complete![/bold green]")
    console.print(f"  Questions added: {summary.questions_added}")
    console.print(f"  Total questions in qbank: {summary.total_questions}")
    console.print(f"  Output: {summary.output_dir}")
    return True, summary
