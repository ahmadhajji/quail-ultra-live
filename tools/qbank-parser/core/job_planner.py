"""Deterministic dry-run planning for pipeline jobs."""

from __future__ import annotations

from adapters.filesystem_adapter import FilesystemAdapter
from core.job_models import PlannedAction, RunJobParams
from parsers.google_api import extract_presentation_id


def build_job_plan(params: RunJobParams, fs: FilesystemAdapter) -> list[PlannedAction]:
    """Build deterministic side-effect plan for the requested job."""
    slides_id: str | None = None
    if params.google_slides_link:
        try:
            slides_id = extract_presentation_id(params.google_slides_link)
        except ValueError:
            slides_id = None

    if params.job_type == "extract":
        actions = []
        if params.pptx_path:
            from pathlib import Path

            actions.append(
                PlannedAction(
                    stage="extract",
                    action="read",
                    path=str(Path(params.pptx_path).resolve()),
                    exists=Path(params.pptx_path).exists(),
                    detail="Input PPTX file",
                )
            )
        if params.google_slides_link:
            actions.append(
                PlannedAction(
                    stage="extract",
                    action="parse_link",
                    path=params.google_slides_link,
                    exists=True,
                    detail="Google Slides share link input",
                )
            )
        actions.extend(fs.extract_actions(slides_id=slides_id))
        return actions

    if params.job_type == "format":
        return fs.format_actions(params.archive_current_format_state)

    if params.job_type == "export_quail":
        return fs.quail_actions(
            source_json=params.quail_source_json,
            output_dir=params.quail_output_dir,
            images_dir=params.quail_images_dir,
            append=params.quail_append,
        )

    return fs.full_pipeline_actions(
        pptx_path=params.pptx_path,
        slides_id=slides_id,
        archive_current_state=params.archive_current_format_state,
        source_json=params.quail_source_json,
        output_dir=params.quail_output_dir,
        images_dir=params.quail_images_dir,
        append=params.quail_append,
    )
