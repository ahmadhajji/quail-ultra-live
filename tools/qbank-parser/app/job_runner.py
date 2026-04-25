"""Unified job runner used by CLI and Streamlit UI."""

from __future__ import annotations

from collections.abc import Callable

from adapters.filesystem_adapter import FilesystemAdapter
from adapters.workflow_adapter import WorkflowAdapter
from config import OUTPUT_DIR
from core.job_models import RunJobParams, RunJobResult
from core.job_planner import build_job_plan
from core.job_validation import validate_run_params


def run_job(
    params: RunJobParams,
    logger: Callable[[str], None] | None = None,
    *,
    workflow_adapter: WorkflowAdapter | None = None,
    filesystem_adapter: FilesystemAdapter | None = None,
) -> RunJobResult:
    """Validate, plan, and optionally execute a pipeline job."""
    fs = filesystem_adapter or FilesystemAdapter(OUTPUT_DIR)
    log_lines: list[str] = []

    def _log(message: str) -> None:
        log_lines.append(message)
        if logger:
            logger(message)

    errors = validate_run_params(params, fs)
    if errors:
        message = "\n".join(errors)
        _log(f"Validation failed:\n{message}")
        return RunJobResult(
            success=False,
            job_type=params.job_type,
            dry_run=params.dry_run,
            planned_actions=[],
            logs=log_lines,
            error_message=message,
        )

    planned_actions = build_job_plan(params, fs)

    if params.dry_run:
        _log(f"Dry-run complete. Planned {len(planned_actions)} actions.")
        return RunJobResult(
            success=True,
            job_type=params.job_type,
            dry_run=True,
            summary={"planned_action_count": len(planned_actions)},
            planned_actions=planned_actions,
            logs=log_lines,
        )

    adapter = workflow_adapter
    if adapter is None:
        from app import workflows

        adapter = WorkflowAdapter(workflows)

    try:
        success, summary, artifacts = adapter.run(params, _log)
    except Exception as exc:
        _log(f"Execution failed: {exc}")
        return RunJobResult(
            success=False,
            job_type=params.job_type,
            dry_run=False,
            planned_actions=planned_actions,
            logs=log_lines,
            error_message=str(exc),
        )

    return RunJobResult(
        success=bool(success),
        job_type=params.job_type,
        dry_run=False,
        summary=summary,
        artifacts=artifacts,
        planned_actions=planned_actions,
        logs=log_lines,
        error_message=None if success else "Job stage failed. Check logs for details.",
    )
