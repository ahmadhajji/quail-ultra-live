"""Extraction orchestration service."""

from __future__ import annotations

import asyncio
import hashlib
import json
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

from rich.progress import BarColumn, Progress, SpinnerColumn, TextColumn

from domain.models import ExtractedQuestion, SlideContent
from storage.run_repository import RunRepository
from storage.run_state import EXTRACT_PARTIAL_FILENAME, RUN_STATE_FILENAME, RunStateUpdate
from utils.image_renderer import pptx_to_images
from utils.question_hardening import audit_same_slide_conflicts, compute_dedupe_fingerprint


def _log(console: Any, message: str) -> None:
    if console:
        console.print(message)
    else:
        print(message)


@dataclass
class ExtractionServiceDeps:
    """External dependencies for extraction orchestration."""

    console: Any
    print_banner: Callable[[], None]
    parse_pptx: Callable[[str | Path, Path], list[SlideContent]]
    fetch_comments: Callable[[str], list[Any]]
    get_comments_by_slide: Callable[[list[Any]], dict[int, list[Any]]]
    openai_processor_cls: type
    export_to_json: Callable[..., Path]
    export_to_csv: Callable[..., Path]
    save_progress: Callable[..., None]
    is_progress_compatible: Callable[[dict, Path, int], bool]
    get_speed_profile_config: Callable[[str], dict]
    question_sort_key: Callable[[ExtractedQuestion], tuple]
    output_dir: Path
    openai_api_key: str
    openai_extraction_model: str
    google_slides_id: str
    stats_available: bool
    run_repository: RunRepository | None = None
    init_stats_collector: Callable[..., Any] | None = None
    stats_report_generator_cls: type | None = None
    update_cumulative_stats: Callable[[dict], dict] | None = None
    reset_stats_collector: Callable[[], None] | None = None


class ExtractionService:
    """Run parse + optional comments + extraction workflow."""

    def __init__(self, deps: ExtractionServiceDeps):
        self.deps = deps

    def _source_fingerprint(self, pptx_path: Path, total_slides: int, google_slides_id: str | None) -> str:
        stat = pptx_path.stat()
        payload = json.dumps(
            {
                "path": str(pptx_path.resolve()),
                "size": stat.st_size,
                "mtime_ns": stat.st_mtime_ns,
                "total_slides": total_slides,
                "google_slides_id": google_slides_id or "",
            },
            sort_keys=True,
        )
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()

    def _resume_hint(self, pptx_path: Path) -> str:
        return f'python main.py "{pptx_path}"'

    @staticmethod
    def _deck_id(pptx_path: Path, google_slides_id: str) -> str:
        raw = (google_slides_id or pptx_path.stem).strip().lower()
        safe = "".join(ch if ch.isalnum() or ch in {"-", "_"} else "_" for ch in raw)
        while "__" in safe:
            safe = safe.replace("__", "_")
        return safe.strip("_") or "deck"

    def _persist_extraction_state(
        self,
        *,
        progress_file: Path,
        partial_output_path: Path,
        run_state_path: Path,
        questions: list[ExtractedQuestion],
        processed_slides: set[int],
        source_pptx: Path,
        total_slides: int,
        source_fingerprint: str,
        google_slides_id: str,
        status: str,
        stop_reason: str = "",
        last_completed_id: str = "",
    ) -> None:
        self.deps.save_progress(
            progress_file=progress_file,
            questions=questions,
            processed_slides=processed_slides,
            source_pptx=source_pptx,
            total_slides=total_slides,
        )
        self.deps.export_to_json(questions, partial_output_path)
        repo = self.deps.run_repository or RunRepository()
        repo.save_run_state(
            run_state_path,
            RunStateUpdate(
                provider="openai",
                stage="extract",
                source_fingerprint=source_fingerprint,
                source_path=str(source_pptx.resolve()),
                source_id=google_slides_id,
                model_name=self.deps.openai_extraction_model,
                total_items=total_slides,
                completed_items=len(processed_slides),
                completed_success=sum(1 for q in questions if q.classification == "accepted"),
                completed_failed=sum(1 for q in questions if q.classification in {"rejected", "error"}),
                last_completed_id=last_completed_id,
                status=status,
                stop_reason=stop_reason,
                resume_hint=self._resume_hint(source_pptx),
            ),
        )

    def run_parse_presentation(
        self,
        pptx_path: str | Path,
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
    ) -> bool:
        """
        Service entrypoint.

        Currently delegates to the legacy-equivalent extraction code path to
        preserve behavior while orchestration moves out of main.py.
        """
        return self.run_parse_presentation_legacy(
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

    @staticmethod
    def _limit_slides(
        slides: list[SlideContent],
        *,
        slide_range: tuple[int, int] | None = None,
        max_slides: int | None = None,
        reprocess_slide: int | None = None,
    ) -> list[SlideContent]:
        limited = slides
        if reprocess_slide is not None:
            limited = [slide for slide in limited if slide.slide_number == reprocess_slide]
        if slide_range is not None:
            start, end = slide_range
            limited = [slide for slide in limited if start <= slide.slide_number <= end]
        if max_slides is not None:
            limited = limited[: max(0, max_slides)]
        return limited

    def run_parse_presentation_legacy(
        self,
        pptx_path: str | Path,
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
    ) -> bool:
        """Parse a presentation and optionally run AI extraction."""
        pptx_path = Path(pptx_path)
        console = self.deps.console

        if not pptx_path.exists():
            _log(console, f"[red]Error: File not found: {pptx_path}[/red]")
            return False

        self.deps.print_banner()
        _log(console, f"\n[bold]Parsing:[/bold] {pptx_path.name}")
        _log(console, f"[dim]Size: {pptx_path.stat().st_size / 1024:.1f} KB[/dim]\n")

        stats_collector = None
        if generate_stats and self.deps.stats_available and self.deps.init_stats_collector:
            stats_collector = self.deps.init_stats_collector(enabled=True)
            stats_collector.start(source_file=str(pptx_path))
            _log(console, "[dim]📊 Stats collection enabled[/dim]\n")

        _log(console, "[bold cyan]Step 1/3:[/bold cyan] Parsing PPTX file...")

        try:
            slides = self.deps.parse_pptx(pptx_path, self.deps.output_dir / "extracted_images")
            parsed_slide_count = len(slides)
            slides = self._limit_slides(
                slides,
                slide_range=slide_range,
                max_slides=max_slides,
                reprocess_slide=reprocess_slide,
            )
            _log(console, f"  ✅ Parsed {parsed_slide_count} slides; selected {len(slides)} for this run")
            if stats_collector:
                stats_collector.record_parser_stats(slides)
        except Exception as e:
            _log(console, f"  [red]❌ Error parsing PPTX: {e}[/red]")
            return False

        active_google_slides_id = (google_slides_id or self.deps.google_slides_id or "").strip()
        deck_id = self._deck_id(pptx_path, active_google_slides_id)
        try:
            rendered_dir = self.deps.output_dir / "rendered_source_slides"
            rendered_images = pptx_to_images(pptx_path, rendered_dir)
            rendered_by_slide = {index + 1: rendered_image for index, rendered_image in enumerate(rendered_images)}
            for slide in slides:
                slide.slide_image_path = rendered_by_slide.get(slide.slide_number, "")
        except Exception as e:
            _log(console, f"  [yellow]⚠️ Could not render source slides: {e}[/yellow]")

        comments_by_slide = {}
        if use_google_api and active_google_slides_id:
            _log(console, "\n[bold cyan]Step 2/3:[/bold cyan] Fetching comments from Google...")
            try:
                comments = self.deps.fetch_comments(active_google_slides_id)
                comments_by_slide = self.deps.get_comments_by_slide(comments)
                _log(console, f"  ✅ Fetched {len(comments)} comments")
                if stats_collector:
                    stats_collector.record_comment_stats(comments, comments_by_slide)
            except Exception as e:
                _log(console, f"  [yellow]⚠️ Could not fetch comments: {e}[/yellow]")
        elif use_google_api:
            _log(
                console,
                "\n[bold cyan]Step 2/3:[/bold cyan] [yellow]Skipping Google API (missing Slides ID)[/yellow]",
            )
            _log(console, "  [dim]Set GOOGLE_SLIDES_ID in .env or pass --google-slides-id[/dim]")
        else:
            _log(
                console,
                "\n[bold cyan]Step 2/3:[/bold cyan] [dim]Skipping Google API (not configured)[/dim]",
            )

        partial_output_path = self.deps.output_dir / EXTRACT_PARTIAL_FILENAME
        run_state_path = self.deps.output_dir / RUN_STATE_FILENAME
        source_fingerprint = self._source_fingerprint(pptx_path, len(slides), active_google_slides_id)

        if use_ai and self.deps.openai_api_key:
            _log(console, "\n[bold cyan]Step 3/3:[/bold cyan] Processing with OpenAI extraction AI...")

            profile = self.deps.get_speed_profile_config(speed_profile)
            if ai_workers is None:
                ai_workers = profile["default_workers"]
            ai_workers = max(1, ai_workers)

            if checkpoint_every is None:
                checkpoint_every = profile["checkpoint_every"]
            checkpoint_every = max(1, checkpoint_every)

            _log(
                console,
                f"  [dim]Speed profile:[/dim] [bold]{speed_profile}[/bold] "
                f"(thinking={profile['thinking_level']}, prompt={profile['prompt_mode']}, workers={ai_workers})",
            )

            progress_file = self.deps.output_dir / "extraction_progress.json"
            extracted_questions: list[ExtractedQuestion] = []
            processed_slides: set[int] = set()

            if progress_file.exists():
                _log(console, "\n[yellow]📂 Found previous progress file![/yellow]")
                try:
                    if self.deps.run_repository:
                        progress_data = self.deps.run_repository.load_extraction_progress(progress_file)
                    else:
                        with open(progress_file) as f:
                            progress_data = json.load(f)
                    if self.deps.is_progress_compatible(progress_data, pptx_path, len(slides)):
                        processed_slides = set(progress_data.get("processed_slides", []))
                        extracted_questions = []
                        for q_data in progress_data.get("questions", []):
                            if isinstance(q_data, dict):
                                extracted_questions.append(ExtractedQuestion.from_dict(q_data))
                        _log(console, f"  ✅ Resuming from slide {len(processed_slides) + 1}/{len(slides)}")
                    else:
                        _log(
                            console,
                            "  [yellow]⚠️ Progress file belongs to a different deck or an outdated version.[/yellow]",
                        )
                        _log(console, "  [dim]Starting fresh for this presentation.[/dim]")
                except Exception as e:
                    _log(console, f"  [yellow]⚠️ Could not load progress: {e}[/yellow]")
                    processed_slides = set()
                    extracted_questions = []

            multi_question_slides = 0
            vision_slides = 0
            skipped_slides = 0

            slides_to_process = [s for s in slides if s.slide_number not in processed_slides]

            _log(console, f"\n  Processing {len(slides_to_process)} remaining slides...")

            thread_local = threading.local()

            def get_worker_processor():
                processor = getattr(thread_local, "processor", None)
                if processor is None:
                    processor = self.deps.openai_processor_cls(
                        self.deps.openai_api_key,
                        model_name=self.deps.openai_extraction_model,
                        prompt_mode=profile["prompt_mode"],
                        min_request_interval=profile["min_request_interval"],
                    )
                    thread_local.processor = processor
                return processor

            def process_single_slide(slide: SlideContent) -> list[ExtractedQuestion]:
                slide_comments = comments_by_slide.get(slide.slide_number, [])
                comments_text = "\n".join([c.content for c in slide_comments])

                results = get_worker_processor().process_slide(
                    slide_number=slide.slide_number,
                    slide_text="\n".join(slide.texts),
                    speaker_notes=slide.speaker_notes,
                    highlighted=", ".join(slide.highlighted_texts) or slide.potential_correct_answer,
                    comments=comments_text,
                    images=slide.images.copy() if slide.images else [],
                    slide_image_path=getattr(slide, "slide_image_path", ""),
                )

                comments_data = [{"author": c.author, "content": c.content} for c in slide_comments]
                for result in results:
                    result.comments = comments_data
                    result.deck_id = deck_id
                    result.source_group_id = f"{deck_id}:{slide.slide_number}"
                    result.source_slide_path = getattr(slide, "slide_image_path", "")
                    result.slide_consensus_status = getattr(slide, "slide_consensus_status", "")
                    result.dedupe_fingerprint = compute_dedupe_fingerprint(result.source_group_id, result.question_stem)

                return results

            with Progress(
                SpinnerColumn(),
                TextColumn("[progress.description]{task.description}"),
                BarColumn(),
                TextColumn("[progress.percentage]{task.percentage:>3.0f}%"),
                TextColumn("[cyan]Slide {task.completed}/{task.total}[/cyan]"),
                console=console,
            ) as progress:
                task = progress.add_task("Processing slides...", total=len(slides_to_process))

                if slides_to_process:
                    try:
                        with ThreadPoolExecutor(max_workers=ai_workers) as executor:
                            future_to_slide = {
                                executor.submit(process_single_slide, slide): slide for slide in slides_to_process
                            }
                            completed_count = 0

                            for future in as_completed(future_to_slide):
                                slide = future_to_slide[future]
                                try:
                                    results = future.result()

                                    reviewable_results = [
                                        r for r in results if r.classification in {"accepted", "needs_review"}
                                    ]
                                    if len(reviewable_results) > 1:
                                        multi_question_slides += 1
                                    if any(r.extraction_method == "vision" for r in results):
                                        vision_slides += 1

                                    extracted_questions.extend(results)
                                    if max_questions is not None and len(extracted_questions) >= max_questions:
                                        extracted_questions = extracted_questions[:max_questions]
                                        for pending in future_to_slide:
                                            pending.cancel()
                                        break
                                except Exception as e:
                                    _log(
                                        console,
                                        f"\n  [yellow]⚠️ Error on slide {slide.slide_number}: {e}[/yellow]",
                                    )
                                    extracted_questions.append(
                                        ExtractedQuestion(
                                            slide_number=slide.slide_number,
                                            classification="error",
                                            review_status="pending",
                                            review_reasons=["Worker exception during extraction"],
                                            error=str(e),
                                        )
                                    )
                                    skipped_slides += 1

                                processed_slides.add(slide.slide_number)
                                completed_count += 1
                                progress.update(task, advance=1)

                                if completed_count % checkpoint_every == 0 or completed_count == len(slides_to_process):
                                    extracted_questions.sort(key=self.deps.question_sort_key)
                                    self._persist_extraction_state(
                                        progress_file=progress_file,
                                        partial_output_path=partial_output_path,
                                        run_state_path=run_state_path,
                                        questions=extracted_questions,
                                        processed_slides=processed_slides,
                                        source_pptx=pptx_path,
                                        total_slides=len(slides),
                                        source_fingerprint=source_fingerprint,
                                        google_slides_id=active_google_slides_id,
                                        status="running",
                                        last_completed_id=str(slide.slide_number),
                                    )

                    except KeyboardInterrupt:
                        _log(console, "\n\n[yellow]⏸️ Interrupted! Progress saved.[/yellow]")
                        _log(console, f"  Processed {len(processed_slides)}/{len(slides)} slides")
                        _log(console, "  Run the same command again to resume.")
                        extracted_questions.sort(key=self.deps.question_sort_key)
                        self._persist_extraction_state(
                            progress_file=progress_file,
                            partial_output_path=partial_output_path,
                            run_state_path=run_state_path,
                            questions=extracted_questions,
                            processed_slides=processed_slides,
                            source_pptx=pptx_path,
                            total_slides=len(slides),
                            source_fingerprint=source_fingerprint,
                            google_slides_id=active_google_slides_id,
                            status="interrupted",
                            stop_reason="Keyboard interrupt",
                        )
                        return False

            extracted_questions.sort(key=self.deps.question_sort_key)
            if max_questions is not None:
                extracted_questions = extracted_questions[:max_questions]
            audit_same_slide_conflicts(extracted_questions)
            accepted_count = sum(1 for q in extracted_questions if q.classification == "accepted")
            needs_review_count = sum(1 for q in extracted_questions if q.classification == "needs_review")
            rejected_count = sum(1 for q in extracted_questions if q.classification == "rejected")
            error_count = sum(1 for q in extracted_questions if q.classification == "error")

            _log(console, f"\n  ✅ Processed {len(slides)} slides")
            _log(console, f"     • {accepted_count} accepted questions")
            _log(console, f"     • {needs_review_count} questions need review")
            _log(console, f"     • {rejected_count} rejected items")
            if multi_question_slides > 0:
                _log(console, f"     • {multi_question_slides} slides had multiple questions")
            if vision_slides > 0:
                _log(console, f"     • {vision_slides} slides used vision/OCR (screenshots)")
            if error_count > 0:
                _log(console, f"     • [yellow]{error_count} extraction errors[/yellow]")

            output_path = self.deps.export_to_json(
                extracted_questions, self.deps.output_dir / "extracted_questions.json"
            )
            _log(console, f"\n[green]Saved to:[/green] {output_path}")

            csv_path = self.deps.export_to_csv(extracted_questions, self.deps.output_dir / "extracted_questions.csv")
            _log(console, f"[green]CSV saved to:[/green] {csv_path}")

            if progress_file.exists():
                progress_file.unlink()
                _log(console, "[dim]Progress file cleaned up.[/dim]")
            if partial_output_path.exists():
                partial_output_path.unlink()
            (self.deps.run_repository or RunRepository()).save_run_state(
                run_state_path,
                RunStateUpdate(
                    provider="openai",
                    stage="extract",
                    source_fingerprint=source_fingerprint,
                    source_path=str(pptx_path.resolve()),
                    source_id=active_google_slides_id,
                    model_name=self.deps.openai_extraction_model,
                    total_items=len(slides),
                    completed_items=len(processed_slides),
                    completed_success=accepted_count,
                    completed_failed=rejected_count + error_count,
                    last_completed_id=str(max(processed_slides) if processed_slides else ""),
                    status="completed",
                    resume_hint=self._resume_hint(pptx_path),
                ),
            )

            if stats_collector:
                stats_collector.record_question_stats(extracted_questions)
        else:
            _log(console, "\n[bold cyan]Step 3/3:[/bold cyan] [yellow]Skipping AI (not configured)[/yellow]")
            _log(console, "  Add OPENAI_API_KEY to .env file to enable AI extraction")

        _log(console, "\n[bold green]✅ Extraction complete![/bold green]")

        if stats_collector:
            try:
                summary = stats_collector.finalize()

                if not self.deps.stats_report_generator_cls:
                    raise RuntimeError("StatsReportGenerator dependency missing")
                report_gen = self.deps.stats_report_generator_cls()
                timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                report_path = self.deps.output_dir / f"stats_report_{timestamp}.html"
                report_gen.generate_html(summary, report_path)

                _log(console, f"\n[bold magenta]📊 Stats Report:[/bold magenta] {report_path}")
                _log(console, f"   • Total AI calls: {summary['ai_summary']['total_calls']}")
                _log(console, f"   • Total tokens: {summary['ai_summary']['total_tokens']:,}")
                if summary["cost_estimate"].get("usage_status") == "unknown":
                    _log(console, "   • Estimated cost: unknown (provider usage was not returned)")
                else:
                    _log(console, f"   • Estimated cost: ${summary['cost_estimate']['total_cost_usd']:.4f}")

                json_path = self.deps.output_dir / f"stats_report_{timestamp}.json"
                with open(json_path, "w") as f:
                    json.dump(summary, f, indent=2)
                _log(console, f"   • JSON data: {json_path}")

                if self.deps.update_cumulative_stats:
                    try:
                        cumulative = self.deps.update_cumulative_stats(summary)
                        all_time = cumulative["all_time"]
                        _log(console, "\n[bold cyan]📈 All-Time Totals:[/bold cyan]")
                        _log(console, f"   • Total runs: {all_time['total_runs']}")
                        _log(console, f"   • All-time tokens: {all_time['total_tokens']:,}")
                        _log(console, f"   • All-time cost: ${all_time['estimated_cost_usd']:.4f}")
                    except Exception as e:
                        _log(console, f"[dim]Could not update cumulative stats: {e}[/dim]")

                if self.deps.reset_stats_collector:
                    self.deps.reset_stats_collector()
            except Exception as e:
                _log(console, f"[yellow]⚠️ Could not generate stats report: {e}[/yellow]")

        _log(console, "\nNext steps:")
        _log(console, "  1. Review questions: [cyan]python main.py --review[/cyan]")
        _log(console, "  2. Format as USMLE: [cyan]python main.py --format-usmle[/cyan]")
        return True
