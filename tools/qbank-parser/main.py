"""CLI entrypoint for QBank Parser with shared job runner integration."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from app.job_runner import run_job
from app import workflows as workflow_mod
from core.job_models import RunJobParams

# Re-export runtime configuration and dependencies so existing tests and call sites
# can monkeypatch main-module symbols.
from config import (  # noqa: F401
    OPENAI_API_KEY,
    OPENAI_EXTRACTION_MODEL,
    FORMATTER_PROVIDER,
    OPENAI_FORMATTER_MODEL,
    OPENAI_REASONING_EFFORT,
    OPENAI_WEB_SEARCH,
    OPENAI_TARGET_RPM,
    OPENAI_MAX_INFLIGHT,
    GOOGLE_SLIDES_ID,
    OUTPUT_DIR,
    print_config_status,
)
from domain.models import ExtractedQuestion  # noqa: F401
from parsers.pptx_parser import parse_pptx  # noqa: F401
from parsers.google_api import (  # noqa: F401
    fetch_comments,
    get_comments_by_slide,
    test_google_api_connection,
    extract_presentation_id,
    fetch_presentation_title,
    export_presentation_to_pptx,
)
from ai.openai_processor import OpenAIProcessor, test_openai_connection  # noqa: F401
from review.terminal_ui import TerminalReviewUI  # noqa: F401
from export.csv_export import export_to_csv, export_to_json, load_from_json  # noqa: F401
from export.usmle_formatter import ModelAccessError, USMLEFormatter, export_usmle_questions  # noqa: F401
from export.native_quail_export import export_native_quail_qbank  # noqa: F401
from export.quail_export import export_quail_qbank  # noqa: F401
from export.quail_repair import default_repair_output_dir, repair_quail_qbank_images  # noqa: F401
from ai.rotation_prompts import normalize_rotation_name, CANONICAL_ROTATIONS  # noqa: F401
from app.extraction_service import ExtractionService, ExtractionServiceDeps  # noqa: F401
from app.status_service import StatusService, StatusServiceDeps  # noqa: F401
from storage.run_repository import RunRepository  # noqa: F401
from utils.question_keys import question_key as build_question_key  # noqa: F401

try:
    from stats.collector import init_stats_collector, get_stats_collector, reset_stats_collector  # noqa: F401
    from stats.report_generator import StatsReportGenerator  # noqa: F401
    from stats.cumulative import update_cumulative_stats, format_cumulative_report  # noqa: F401

    STATS_AVAILABLE = True
except ImportError:
    STATS_AVAILABLE = False
    init_stats_collector = None
    get_stats_collector = None
    reset_stats_collector = None
    StatsReportGenerator = None
    update_cumulative_stats = None
    format_cumulative_report = None


console = workflow_mod.console
RICH_AVAILABLE = workflow_mod.RICH_AVAILABLE
RUN_REPOSITORY = workflow_mod.RUN_REPOSITORY
SPEED_PROFILES = workflow_mod.SPEED_PROFILES


def _sync_workflow_globals() -> None:
    """Propagate main module globals into app.workflows for compatibility."""
    mappings = {
        "console": console,
        "RICH_AVAILABLE": RICH_AVAILABLE,
        "RUN_REPOSITORY": RUN_REPOSITORY,
        "SPEED_PROFILES": SPEED_PROFILES,
        "OPENAI_API_KEY": OPENAI_API_KEY,
        "OPENAI_EXTRACTION_MODEL": OPENAI_EXTRACTION_MODEL,
        "FORMATTER_PROVIDER": FORMATTER_PROVIDER,
        "OPENAI_FORMATTER_MODEL": OPENAI_FORMATTER_MODEL,
        "OPENAI_REASONING_EFFORT": OPENAI_REASONING_EFFORT,
        "OPENAI_WEB_SEARCH": OPENAI_WEB_SEARCH,
        "OPENAI_TARGET_RPM": OPENAI_TARGET_RPM,
        "OPENAI_MAX_INFLIGHT": OPENAI_MAX_INFLIGHT,
        "GOOGLE_SLIDES_ID": GOOGLE_SLIDES_ID,
        "OUTPUT_DIR": OUTPUT_DIR,
        "print_config_status": print_config_status,
        "parse_pptx": parse_pptx,
        "fetch_comments": fetch_comments,
        "get_comments_by_slide": get_comments_by_slide,
        "test_openai_connection": test_openai_connection,
        "OpenAIProcessor": OpenAIProcessor,
        "TerminalReviewUI": TerminalReviewUI,
        "export_to_json": export_to_json,
        "export_to_csv": export_to_csv,
        "load_from_json": load_from_json,
        "ModelAccessError": ModelAccessError,
        "USMLEFormatter": USMLEFormatter,
        "export_usmle_questions": export_usmle_questions,
        "export_quail_qbank": export_quail_qbank,
        "normalize_rotation_name": normalize_rotation_name,
        "CANONICAL_ROTATIONS": CANONICAL_ROTATIONS,
        "ExtractionService": ExtractionService,
        "ExtractionServiceDeps": ExtractionServiceDeps,
        "StatusService": StatusService,
        "StatusServiceDeps": StatusServiceDeps,
        "RunRepository": RunRepository,
        "build_question_key": build_question_key,
        "extract_presentation_id": extract_presentation_id,
        "fetch_presentation_title": fetch_presentation_title,
        "export_presentation_to_pptx": export_presentation_to_pptx,
        "STATS_AVAILABLE": STATS_AVAILABLE,
        "init_stats_collector": init_stats_collector,
        "StatsReportGenerator": StatsReportGenerator,
        "update_cumulative_stats": update_cumulative_stats,
        "reset_stats_collector": reset_stats_collector,
        "format_cumulative_report": format_cumulative_report,
    }
    for key, value in mappings.items():
        setattr(workflow_mod, key, value)


# Compatibility wrappers for existing tests/imports.
def get_speed_profile_config(speed_profile: str) -> dict:
    _sync_workflow_globals()
    return workflow_mod.get_speed_profile_config(speed_profile)


def question_sort_key(question: ExtractedQuestion) -> tuple:
    _sync_workflow_globals()
    return workflow_mod.question_sort_key(question)


def question_key(slide_number: int, question_index: int = 1, question_id: str = "") -> str:
    _sync_workflow_globals()
    return workflow_mod.question_key(slide_number, question_index, question_id)


def slugify_identifier(value: str, fallback: str = "deck") -> str:
    _sync_workflow_globals()
    return workflow_mod.slugify_identifier(value, fallback)


def infer_rotation_from_title(title: str) -> str:
    _sync_workflow_globals()
    return workflow_mod.infer_rotation_from_title(title)


def save_progress(*args, **kwargs):
    _sync_workflow_globals()
    return workflow_mod.save_progress(*args, **kwargs)


def is_progress_compatible(progress_data: dict, source_pptx: Path, total_slides: int) -> bool:
    _sync_workflow_globals()
    return workflow_mod.is_progress_compatible(progress_data, source_pptx, total_slides)


def print_banner() -> None:
    _sync_workflow_globals()
    return workflow_mod.print_banner()


def check_status() -> None:
    _sync_workflow_globals()
    return workflow_mod.check_status()


def parse_presentation(*args, **kwargs):
    _sync_workflow_globals()
    return workflow_mod.parse_presentation(*args, **kwargs)


def review_questions() -> None:
    _sync_workflow_globals()
    return workflow_mod.review_questions()


def archive_formatter_state(active_provider: str):
    _sync_workflow_globals()
    return workflow_mod.archive_formatter_state(active_provider)


def format_questions_to_usmle_outputs(*args, **kwargs):
    _sync_workflow_globals()
    return workflow_mod.format_questions_to_usmle_outputs(*args, **kwargs)


def format_usmle(*args, **kwargs):
    _sync_workflow_globals()
    return workflow_mod.format_usmle(*args, **kwargs)


_MAIN_PARSE_PRESENTATION_WRAPPER = parse_presentation
_MAIN_FORMAT_QUESTIONS_WRAPPER = format_questions_to_usmle_outputs


def run_two_sequential(*args, **kwargs):
    _sync_workflow_globals()
    original_parse = workflow_mod.parse_presentation
    original_format = workflow_mod.format_questions_to_usmle_outputs
    try:
        patched_parse = globals().get("parse_presentation")
        if patched_parse is not _MAIN_PARSE_PRESENTATION_WRAPPER:
            workflow_mod.parse_presentation = patched_parse

        patched_format = globals().get("format_questions_to_usmle_outputs")
        if patched_format is not _MAIN_FORMAT_QUESTIONS_WRAPPER:
            workflow_mod.format_questions_to_usmle_outputs = patched_format

        return workflow_mod.run_two_sequential(*args, **kwargs)
    finally:
        workflow_mod.parse_presentation = original_parse
        workflow_mod.format_questions_to_usmle_outputs = original_format


def export_quail(*args, **kwargs):
    _sync_workflow_globals()
    return workflow_mod.export_quail(*args, **kwargs)


def _print(message: str) -> None:
    if console:
        console.print(message)
    else:
        print(message)


def _run_quail_repair(
    *,
    source_dir: str,
    output_dir: str | None,
    dry_run: bool,
) -> bool:
    resolved_output = Path(output_dir).resolve() if output_dir else default_repair_output_dir(source_dir)

    try:
        summary = repair_quail_qbank_images(
            source_dir=source_dir,
            output_dir=resolved_output,
            dry_run=dry_run,
            logger=_print,
        )
    except Exception as exc:
        _print(f"[red]Quail repair failed:[/red] {exc}")
        return False

    if dry_run:
        _print(
            "[bold]Repair dry-run summary:[/bold] "
            f"{summary.questions_scanned} question(s), "
            f"{summary.images_scanned} image(s), "
            f"{summary.images_moved} planned move(s), "
            f"output {resolved_output}"
        )
        return True

    _print(
        "[bold green]Quail repair completed.[/bold green] "
        f"Adjusted copy: {summary.output_dir} "
        f"({summary.images_moved} moved / {summary.images_kept} kept)"
    )
    return True

def _run_job_and_report(params: RunJobParams) -> bool:
    result = run_job(params)

    for line in result.logs:
        _print(f"[dim]{line}[/dim]" if console else line)

    if not result.success:
        _print(f"[red]Job failed:[/red] {result.error_message or 'Unknown error'}")
        return False

    if result.dry_run:
        _print(f"\n[bold]Dry-run planned actions ({len(result.planned_actions)}):[/bold]")
        for action in result.planned_actions:
            exists_marker = "exists" if action.exists else "new"
            _print(
                f"  • [{action.stage}] {action.action.upper()} {action.path} ({exists_marker})"
                + (f" - {action.detail}" if action.detail else "")
            )
        return True

    _print("[bold green]Job completed successfully.[/bold green]")
    for artifact in result.artifacts:
        if artifact.exists:
            _print(f"  • {artifact.kind}: {artifact.path}")
    return True


def _parse_slide_range(value: str | None) -> tuple[int, int] | None:
    if not value:
        return None
    if "-" not in value:
        slide = int(value)
        return slide, slide
    start, end = value.split("-", 1)
    return int(start), int(end)


def _run_native_export_from_extracted(args: argparse.Namespace) -> bool:
    source_json = Path(args.quail_source_json) if args.quail_source_json else OUTPUT_DIR / "extracted_questions.json"
    if not source_json.exists():
        _print(f"[red]Native export failed:[/red] source JSON not found: {source_json}")
        return False
    native_pack_dir = Path(args.native_pack_dir) if args.native_pack_dir else OUTPUT_DIR / "packs" / (args.pack_id or "qbank")
    try:
        summary = export_native_quail_qbank(
            source_json=source_json,
            output_dir=native_pack_dir,
            images_dir=Path(args.quail_images_dir) if args.quail_images_dir else None,
            append=bool(args.append_native or args.quail_append),
            pack_id=args.pack_id or "qbank",
            title=args.title or (f"{args.rotation} QBank" if args.rotation else None),
            slide_range=_parse_slide_range(args.slide_range),
            max_questions=args.max_questions,
            only_new=args.only_new,
            only_failed=args.only_failed,
            reprocess_question=args.reprocess_question,
        )
    except Exception as exc:
        _print(f"[red]Native export failed:[/red] {exc}")
        return False
    _print(f"[bold green]Native Quail Ultra pack ready:[/bold green] {summary.output_dir}")
    if summary.qa_report_markdown:
        _print(f"  • QA report: {summary.qa_report_markdown}")
    return True


def _run_v2_pipeline(args: argparse.Namespace) -> bool:
    """Run the simplified v2 pipeline (Stages 1+2 land in PR 2; Stages 3+4 in PR 3+4)."""
    if not args.pptx_file and not args.google_slides_link:
        _print("[red]--v2 requires either a PPTX file or --google-slides-link[/red]")
        return False
    if not args.rotation:
        _print("[red]--v2 requires --rotation (no inference; e.g. --rotation Pediatrics)[/red]")
        return False

    from app.v2_pipeline import V2RunOptions, run_v2_pipeline

    opts = V2RunOptions(
        google_slides_link=args.google_slides_link or "",
        google_slides_id=args.google_slides_id or "",
        pptx_path=args.pptx_file or "",
        rotation=args.rotation,
        pack_id=args.pack_id or "qbank",
        title=args.title or (f"{args.rotation} QBank" if args.rotation else ""),
        output_dir=Path(args.native_pack_dir) if args.native_pack_dir else OUTPUT_DIR,
        api_key=OPENAI_API_KEY,
    )

    try:
        result = run_v2_pipeline(opts)
    except Exception as exc:
        _print(f"[red]v2 pipeline failed:[/red] {exc}")
        return False

    _print(
        f"[bold green]v2 pipeline complete:[/bold green] {result.metadata['slide_count']} slides, "
        f"{len(result.detected_questions)} questions detected, "
        f"{len(result.rewritten_questions)} questions rewritten, "
        f"{result.stats.ai_calls} AI calls "
        f"({result.stats.prompt_tokens + result.stats.completion_tokens} tokens), "
        f"{result.stats.cache_hits} cache hits, "
        f"{result.stats.duration_seconds:.1f}s"
    )
    if result.stage2_errors:
        _print(f"[yellow]Stage 2 errors on {len(result.stage2_errors)} slides:[/yellow]")
        for slide_num, msg in sorted(result.stage2_errors.items()):
            _print(f"  • slide {slide_num}: {msg}")
    if result.stage3_errors:
        _print(f"[yellow]Stage 3 errors on {len(result.stage3_errors)} questions:[/yellow]")
        for qid, msg in sorted(result.stage3_errors.items()):
            _print(f"  • {qid}: {msg}")
    if result.pack_summary is not None:
        _print(
            f"[bold green]Native Quail Ultra pack ready:[/bold green] "
            f"{getattr(result.pack_summary, 'output_dir', '<unknown>')}"
        )
        qa_report = getattr(result.pack_summary, "qa_report_markdown", None)
        if qa_report:
            _print(f"  • QA report: {qa_report}")
    return True


def main() -> None:
    parser = argparse.ArgumentParser(
        description="QBank Parser - Extract and format medical questions from Google Slides",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python main.py presentation.pptx       Parse a PPTX file
  python main.py --google-slides-link <SHARE_LINK>
                                         Download PPTX from Google Slides then parse
  python main.py --format-usmle          Format as USMLE questions
  python main.py --export-quail          Export to Quail qbank
  python main.py --full-pipeline deck.pptx
                                         Run extract -> format -> Quail
  python main.py --status                Check configuration
        """,
    )

    parser.add_argument("pptx_file", nargs="?", help="Path to PPTX file to parse")
    parser.add_argument(
        "--run-two-sequential",
        nargs=2,
        metavar=("INPUT1", "INPUT2"),
        help="Run full pipeline for two Google Slides inputs (URL or raw ID), sequentially",
    )
    parser.add_argument(
        "--rotations",
        nargs=2,
        metavar=("ROT1", "ROT2"),
        default=None,
        help='Optional rotation override for --run-two-sequential (e.g. "OB-GYN" "Internal Medicine")',
    )
    parser.add_argument("--review", action="store_true", help="Run interactive review")
    parser.add_argument("--format-usmle", action="store_true", help="Format as USMLE questions")
    parser.add_argument("--export-quail", action="store_true", help="Export USMLE JSON as Quail qbank")
    parser.add_argument(
        "--repair-quail-dir",
        type=str,
        default=None,
        help="Repair an existing flat Quail qbank by copying it to a temp/output dir and moving answer-revealing images.",
    )
    parser.add_argument(
        "--repair-output-dir",
        type=str,
        default=None,
        help="Destination directory for the adjusted Quail copy (defaults to /tmp/qbank-parser-repairs/<name>-adjusted-<timestamp>).",
    )
    parser.add_argument("--full-pipeline", action="store_true", help="Run extract -> format -> Quail on a PPTX input")
    parser.add_argument(
        "--formatter-provider",
        choices=["openai"],
        default="openai",
        help="Provider for USMLE formatting stage",
    )
    parser.add_argument(
        "--openai-model",
        type=str,
        default=OPENAI_FORMATTER_MODEL,
        help="OpenAI model for formatter provider=openai",
    )
    parser.add_argument(
        "--openai-reasoning-effort",
        choices=["none", "low", "medium", "high", "xhigh"],
        default=OPENAI_REASONING_EFFORT,
        help="OpenAI reasoning effort for formatter provider=openai",
    )
    parser.add_argument(
        "--openai-web-search",
        dest="openai_web_search",
        action="store_true",
        default=OPENAI_WEB_SEARCH,
        help="Enable OpenAI web search grounding",
    )
    parser.add_argument(
        "--no-openai-web-search",
        dest="openai_web_search",
        action="store_false",
        help="Disable OpenAI web search grounding",
    )
    parser.add_argument(
        "--openai-target-rpm",
        type=int,
        default=OPENAI_TARGET_RPM,
        help="Target OpenAI requests-per-minute for adaptive scheduler",
    )
    parser.add_argument(
        "--openai-max-inflight",
        type=int,
        default=OPENAI_MAX_INFLIGHT,
        help="Maximum inflight OpenAI requests for adaptive scheduler",
    )
    parser.add_argument(
        "--archive-current-format-state",
        dest="archive_current_format_state",
        action="store_true",
        default=None,
        help="Archive current formatter artifacts before formatting",
    )
    parser.add_argument(
        "--no-archive-current-format-state",
        dest="archive_current_format_state",
        action="store_false",
        default=None,
        help="Skip archival of current formatter artifacts before formatting",
    )
    parser.add_argument("--status", action="store_true", help="Check status and configuration")
    parser.add_argument("--gui", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--no-ai", action="store_true", help="Skip AI processing during extraction")
    parser.add_argument("--with-google-api", action="store_true", help="Fetch comments from Google API")
    parser.add_argument(
        "--google-slides-link",
        type=str,
        default=None,
        help="Google Slides share link (or raw file ID). If provided, PPTX is downloaded automatically.",
    )
    parser.add_argument(
        "--google-slides-id",
        type=str,
        default=None,
        help="Google Slides file ID override",
    )
    parser.add_argument(
        "--speed-profile",
        choices=["quality", "balanced", "fast"],
        default="balanced",
        help="Extraction speed mode",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=None,
        help="Parallel workers for AI extraction",
    )
    parser.add_argument(
        "--checkpoint-every",
        type=int,
        default=None,
        help="Save extraction progress every N processed slides",
    )
    parser.add_argument("--rotation", type=str, default="", help="Rotation label for native pack title/tags when available")
    parser.add_argument(
        "--v2",
        action="store_true",
        help="Run the simplified v2 pipeline (extract -> detect -> rewrite -> native pack). "
        "Will become default once promoted; see docs/v2-migration-kill-list.md.",
    )
    parser.add_argument("--slide-range", type=str, default=None, help="Only process this inclusive slide range before AI calls, e.g. 1-15")
    parser.add_argument("--max-slides", type=int, default=None, help="Hard cap on selected slides before AI calls")
    parser.add_argument("--max-questions", type=int, default=None, help="Hard cap on extracted/exported questions where practical")
    parser.add_argument("--reprocess-slide", type=int, default=None, help="Only process one source slide")
    parser.add_argument("--native-pack-dir", type=str, default=None, help="Write a Quail Ultra native pack to this directory after extraction")
    parser.add_argument("--pack-id", type=str, default="qbank", help="Stable native pack id")
    parser.add_argument("--append-native", action="store_true", help="Append/update an existing native pack workspace")
    parser.add_argument("--only-new", action="store_true", help="Native export: only include source questions not known in pack_state.json")
    parser.add_argument("--only-failed", action="store_true", help="Native export: only include source questions marked failed/blocked")
    parser.add_argument("--reprocess-question", type=str, default=None, help="Native export: only reprocess this stable question id")
    parser.add_argument("--title", type=str, default=None, help="Display title for native export")
    parser.add_argument("--dry-run-cost", action="store_true", help="Preview extraction/native work without AI calls")
    parser.add_argument("--all-time-stats", action="store_true", help="Show cumulative all-time stats")
    parser.add_argument(
        "--quail-source-json",
        type=str,
        default=None,
        help="Source USMLE JSON for Quail export",
    )
    parser.add_argument(
        "--quail-output-dir",
        type=str,
        default=None,
        help="Output folder for Quail qbank",
    )
    parser.add_argument(
        "--quail-images-dir",
        type=str,
        default=None,
        help="Image folder for Quail export",
    )
    parser.add_argument(
        "--quail-append",
        action="store_true",
        help="Append to existing Quail qbank instead of fresh export",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview writes/deletes/moves for extract/format/export/full-pipeline without side effects",
    )

    args = parser.parse_args()

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    if args.run_two_sequential and args.pptx_file:
        parser.error("Cannot pass both a single pptx_file and --run-two-sequential.")
    if args.run_two_sequential and args.google_slides_link:
        parser.error("Cannot pass --google-slides-link with --run-two-sequential.")

    if args.status:
        check_status()
        return

    if args.v2:
        ok = _run_v2_pipeline(args)
        if not ok:
            sys.exit(1)
        return

    if args.all_time_stats:
        if STATS_AVAILABLE and format_cumulative_report:
            _print(format_cumulative_report())
        else:
            _print("[yellow]Stats module not available.[/yellow]")
        return

    if args.gui:
        parser.error("--gui is deprecated. QBank Parser is terminal-only now. Use `python main.py --help`.")

    if args.review:
        review_questions()
        return

    if args.repair_quail_dir:
        ok = _run_quail_repair(
            source_dir=args.repair_quail_dir,
            output_dir=args.repair_output_dir,
            dry_run=args.dry_run,
        )
        if not ok:
            sys.exit(1)
        return

    if args.run_two_sequential:
        archive_flag = (
            args.archive_current_format_state
            if args.archive_current_format_state is not None
            else (args.formatter_provider == "openai")
        )
        ok = run_two_sequential(
            inputs=args.run_two_sequential,
            rotations=args.rotations,
            speed_profile=args.speed_profile,
            ai_workers=args.workers,
            checkpoint_every=args.checkpoint_every,
            use_google_api=args.with_google_api,
            quail_output_dir=args.quail_output_dir,
            quail_images_dir=args.quail_images_dir,
            quail_append=args.quail_append,
            formatter_provider=args.formatter_provider,
            openai_model=args.openai_model,
            openai_reasoning_effort=args.openai_reasoning_effort,
            openai_web_search=args.openai_web_search,
            openai_target_rpm=args.openai_target_rpm,
            openai_max_inflight=args.openai_max_inflight,
            archive_current_format_state=archive_flag,
        )
        if not ok:
            sys.exit(1)
        return

    archive_flag = (
        args.archive_current_format_state
        if args.archive_current_format_state is not None
        else (args.formatter_provider == "openai")
    )

    if args.full_pipeline:
        if not args.pptx_file and not args.google_slides_link:
            parser.error("--full-pipeline requires either pptx_file or --google-slides-link.")
        ok = _run_job_and_report(
            RunJobParams(
                job_type="full_pipeline",
                pptx_path=args.pptx_file,
                google_slides_link=args.google_slides_link,
                use_ai=not args.no_ai,
                with_google_api=args.with_google_api,
                google_slides_id=args.google_slides_id,
                speed_profile=args.speed_profile,
                workers=args.workers,
                checkpoint_every=args.checkpoint_every,
                slide_range=_parse_slide_range(args.slide_range),
                max_slides=args.max_slides,
                max_questions=args.max_questions,
                reprocess_slide=args.reprocess_slide,
                formatter_provider=args.formatter_provider,
                openai_model=args.openai_model,
                openai_reasoning_effort=args.openai_reasoning_effort,
                openai_web_search=args.openai_web_search,
                openai_target_rpm=args.openai_target_rpm,
                openai_max_inflight=args.openai_max_inflight,
                archive_current_format_state=archive_flag,
                quail_source_json=args.quail_source_json,
                quail_output_dir=args.quail_output_dir,
                quail_images_dir=args.quail_images_dir,
                quail_append=args.quail_append,
                dry_run=args.dry_run,
            )
        )
        if not ok:
            sys.exit(1)
        return

    if args.format_usmle:
        ok = _run_job_and_report(
            RunJobParams(
                job_type="format",
                formatter_provider=args.formatter_provider,
                openai_model=args.openai_model,
                openai_reasoning_effort=args.openai_reasoning_effort,
                openai_web_search=args.openai_web_search,
                openai_target_rpm=args.openai_target_rpm,
                openai_max_inflight=args.openai_max_inflight,
                archive_current_format_state=archive_flag,
                dry_run=args.dry_run,
            )
        )
        if not ok:
            sys.exit(1)
        return

    if args.export_quail:
        ok = _run_job_and_report(
            RunJobParams(
                job_type="export_quail",
                quail_source_json=args.quail_source_json,
                quail_output_dir=args.quail_output_dir,
                quail_images_dir=args.quail_images_dir,
                quail_append=args.quail_append,
                dry_run=args.dry_run,
            )
        )
        if not ok:
            sys.exit(1)
        return

    if args.pptx_file or args.google_slides_link:
        if args.dry_run_cost:
            _print("[bold]Dry-run cost preview:[/bold] no AI calls will be made.")
            _print(f"  • slide_range: {args.slide_range or 'all'}")
            _print(f"  • max_slides: {args.max_slides if args.max_slides is not None else 'none'}")
            _print(f"  • max_questions: {args.max_questions if args.max_questions is not None else 'none'}")
            _print("  • estimated_cost: unknown until provider usage is available")
            return
        ok = _run_job_and_report(
            RunJobParams(
                job_type="extract",
                pptx_path=args.pptx_file,
                google_slides_link=args.google_slides_link,
                use_ai=not args.no_ai,
                with_google_api=args.with_google_api,
                google_slides_id=args.google_slides_id,
                speed_profile=args.speed_profile,
                workers=args.workers,
                checkpoint_every=args.checkpoint_every,
                slide_range=_parse_slide_range(args.slide_range),
                max_slides=args.max_slides,
                max_questions=args.max_questions,
                reprocess_slide=args.reprocess_slide,
                dry_run=args.dry_run,
            )
        )
        if not ok:
            sys.exit(1)
        if args.native_pack_dir:
            if not _run_native_export_from_extracted(args):
                sys.exit(1)
        return

    parser.print_help()


if __name__ == "__main__":
    main()
