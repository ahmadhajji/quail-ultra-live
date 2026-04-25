"""Validation helpers for UI and CLI jobs."""

from __future__ import annotations

from pathlib import Path

from adapters.filesystem_adapter import FilesystemAdapter
from core.job_models import RunJobParams
from parsers.google_api import extract_presentation_id


def validate_run_params(params: RunJobParams, fs: FilesystemAdapter) -> list[str]:
    """Return user-facing validation errors for a job invocation."""
    errors: list[str] = []

    if params.speed_profile not in {"quality", "balanced", "fast"}:
        errors.append("speed_profile must be one of: quality, balanced, fast")

    if params.formatter_provider != "openai":
        errors.append("formatter_provider must be 'openai'")

    if params.openai_reasoning_effort not in {"low", "medium", "high"}:
        errors.append("openai_reasoning_effort must be one of: low, medium, high")

    if params.workers is not None and params.workers < 1:
        errors.append("workers must be a positive integer")

    if params.checkpoint_every is not None and params.checkpoint_every < 1:
        errors.append("checkpoint_every must be a positive integer")

    if params.openai_target_rpm < 1:
        errors.append("openai_target_rpm must be a positive integer")

    if params.openai_max_inflight < 1:
        errors.append("openai_max_inflight must be a positive integer")

    if params.job_type in {"extract", "full_pipeline"}:
        if not params.pptx_path and not params.google_slides_link:
            errors.append(
                "Provide either pptx_path or google_slides_link for extract/full_pipeline jobs"
            )
        if params.pptx_path:
            pptx = Path(params.pptx_path).expanduser().resolve()
            if not pptx.exists() or not pptx.is_file():
                errors.append(f"pptx_path does not exist: {pptx}")
            elif pptx.suffix.lower() != ".pptx":
                errors.append("pptx_path must point to a .pptx file")
        if params.google_slides_link:
            try:
                extract_presentation_id(params.google_slides_link)
            except ValueError as exc:
                errors.append(str(exc))

    if params.job_type == "format":
        if fs.detect_format_source() is None:
            errors.append(
                "No formatting source found. Expected output/reviewed_questions.json "
                "or output/extracted_questions.json"
            )

    if params.job_type == "export_quail":
        source = Path(params.quail_source_json).expanduser().resolve() if params.quail_source_json else (fs.output_dir / "usmle_formatted_questions.json")
        if not source.exists():
            errors.append(f"Quail source JSON not found: {source}")

    if params.quail_output_dir:
        out_dir = Path(params.quail_output_dir).expanduser()
        parent = out_dir if out_dir.suffix == "" else out_dir.parent
        if parent and not parent.exists():
            # Non-fatal but usually a typo. Keep it explicit for UI users.
            errors.append(f"quail_output_dir parent does not exist: {parent.resolve()}")

    return errors
