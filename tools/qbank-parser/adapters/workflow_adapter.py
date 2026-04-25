"""Adapter that executes pipeline workflows with side effects."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

from config import OUTPUT_DIR
from core.job_models import ArtifactRef, RunJobParams


class WorkflowAdapter:
    """Runtime bridge from typed job params into existing workflow functions."""

    def __init__(self, workflows_module: Any):
        self.workflows = workflows_module

    def _resolve_extraction_source(self, params: RunJobParams, log: Callable[[str], None]) -> tuple[str, str | None]:
        pptx_path = (params.pptx_path or "").strip()
        slides_id = (params.google_slides_link or "").strip()
        if not slides_id:
            return pptx_path, params.google_slides_id

        resolved_slides_id = self.workflows.extract_presentation_id(slides_id)
        download_dir = OUTPUT_DIR / "_slides_downloads"
        download_dir.mkdir(parents=True, exist_ok=True)
        download_path = download_dir / f"{resolved_slides_id}.pptx"
        log(f"Downloading Google Slides deck to {download_path} ...")
        self.workflows.export_presentation_to_pptx(resolved_slides_id, download_path)
        return str(download_path.resolve()), resolved_slides_id

    def run_extract(self, params: RunJobParams, log: Callable[[str], None]) -> tuple[bool, dict, list[ArtifactRef]]:
        log("Running extraction workflow...")
        source_pptx, slides_id = self._resolve_extraction_source(params, log)
        use_google_api = params.with_google_api or bool(params.google_slides_link)
        ok = self.workflows.parse_presentation(
            source_pptx,
            use_ai=params.use_ai,
            use_google_api=use_google_api,
            google_slides_id=slides_id or params.google_slides_id,
            generate_stats=True,
            speed_profile=params.speed_profile,
            ai_workers=params.workers,
            checkpoint_every=params.checkpoint_every,
            slide_range=params.slide_range,
            max_slides=params.max_slides,
            max_questions=params.max_questions,
            reprocess_slide=params.reprocess_slide,
        )
        artifacts = [
            ArtifactRef(stage="extract", kind="json", path=str((OUTPUT_DIR / "extracted_questions.json").resolve()), exists=(OUTPUT_DIR / "extracted_questions.json").exists()),
            ArtifactRef(stage="extract", kind="csv", path=str((OUTPUT_DIR / "extracted_questions.csv").resolve()), exists=(OUTPUT_DIR / "extracted_questions.csv").exists()),
            ArtifactRef(stage="extract", kind="partial_json", path=str((OUTPUT_DIR / "extracted_questions.partial.json").resolve()), exists=(OUTPUT_DIR / "extracted_questions.partial.json").exists()),
            ArtifactRef(stage="extract", kind="run_state", path=str((OUTPUT_DIR / "run_state.json").resolve()), exists=(OUTPUT_DIR / "run_state.json").exists()),
        ]
        if params.google_slides_link:
            artifacts.append(
                ArtifactRef(
                    stage="extract",
                    kind="downloaded_pptx",
                    path=str((OUTPUT_DIR / "_slides_downloads" / f"{slides_id}.pptx").resolve()) if slides_id else "",
                    exists=(OUTPUT_DIR / "_slides_downloads" / f"{slides_id}.pptx").exists() if slides_id else False,
                )
            )
        return ok, {"stage": "extract", "success": bool(ok)}, artifacts

    def run_format(self, params: RunJobParams, log: Callable[[str], None]) -> tuple[bool, dict, list[ArtifactRef]]:
        log("Running USMLE formatting workflow...")
        ok = self.workflows.format_usmle(
            formatter_provider=params.formatter_provider,
            openai_model=params.openai_model,
            openai_reasoning_effort=params.openai_reasoning_effort,
            openai_web_search=params.openai_web_search,
            openai_target_rpm=params.openai_target_rpm,
            openai_max_inflight=params.openai_max_inflight,
            archive_current_format_state=params.archive_current_format_state,
        )
        artifacts = [
            ArtifactRef(stage="format", kind="json", path=str((OUTPUT_DIR / "usmle_formatted_questions.json").resolve()), exists=(OUTPUT_DIR / "usmle_formatted_questions.json").exists()),
            ArtifactRef(stage="format", kind="markdown", path=str((OUTPUT_DIR / "usmle_formatted_questions.md").resolve()), exists=(OUTPUT_DIR / "usmle_formatted_questions.md").exists()),
            ArtifactRef(stage="format", kind="partial_json", path=str((OUTPUT_DIR / "usmle_formatted_questions.partial.json").resolve()), exists=(OUTPUT_DIR / "usmle_formatted_questions.partial.json").exists()),
            ArtifactRef(stage="format", kind="run_state", path=str((OUTPUT_DIR / "run_state.json").resolve()), exists=(OUTPUT_DIR / "run_state.json").exists()),
        ]
        return ok, {"stage": "format", "success": bool(ok)}, artifacts

    def run_export_quail(self, params: RunJobParams, log: Callable[[str], None]) -> tuple[bool, dict, list[ArtifactRef]]:
        log("Running Quail export workflow...")
        ok, summary = self.workflows.export_quail(
            source_json=params.quail_source_json,
            output_dir=params.quail_output_dir,
            images_dir=params.quail_images_dir,
            append=params.quail_append,
        )
        target_dir = Path(params.quail_output_dir).resolve() if params.quail_output_dir else (OUTPUT_DIR / "quail_qbank")
        artifacts = [
            ArtifactRef(stage="export_quail", kind="directory", path=str(target_dir.resolve()), exists=target_dir.exists()),
        ]
        summary_data = summary.to_dict() if summary is not None and hasattr(summary, "to_dict") else {}
        summary_data["stage"] = "export_quail"
        summary_data["success"] = bool(ok)
        return ok, summary_data, artifacts

    def run_full_pipeline(self, params: RunJobParams, log: Callable[[str], None]) -> tuple[bool, dict, list[ArtifactRef]]:
        summaries: list[dict] = []
        artifacts: list[ArtifactRef] = []

        ok_extract, summary_extract, artifacts_extract = self.run_extract(params, log)
        summaries.append(summary_extract)
        artifacts.extend(artifacts_extract)
        if not ok_extract:
            return False, {"stages": summaries}, artifacts

        ok_format, summary_format, artifacts_format = self.run_format(params, log)
        summaries.append(summary_format)
        artifacts.extend(artifacts_format)
        if not ok_format:
            return False, {"stages": summaries}, artifacts

        ok_export, summary_export, artifacts_export = self.run_export_quail(params, log)
        summaries.append(summary_export)
        artifacts.extend(artifacts_export)
        if not ok_export:
            return False, {"stages": summaries}, artifacts

        return True, {"stages": summaries}, artifacts

    def run(self, params: RunJobParams, log: Callable[[str], None]) -> tuple[bool, dict, list[ArtifactRef]]:
        if params.job_type == "extract":
            return self.run_extract(params, log)
        if params.job_type == "format":
            return self.run_format(params, log)
        if params.job_type == "export_quail":
            return self.run_export_quail(params, log)
        return self.run_full_pipeline(params, log)
