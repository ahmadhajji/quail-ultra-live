"""Typed job contracts shared by CLI and UI."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

JobType = Literal["extract", "format", "export_quail", "full_pipeline"]
SpeedProfile = Literal["quality", "balanced", "fast"]
ReasoningEffort = Literal["low", "medium", "high"]


@dataclass
class PlannedAction:
    """A deterministic side-effect action used for dry-run previews."""

    stage: str
    action: str
    path: str
    exists: bool = False
    detail: str = ""


@dataclass
class ArtifactRef:
    """A produced or expected output artifact."""

    stage: str
    kind: str
    path: str
    exists: bool = False


@dataclass
class RunJobParams:
    """Unified job invocation parameters for CLI and UI."""

    job_type: JobType
    pptx_path: str | None = None
    google_slides_link: str | None = None
    use_ai: bool = True
    with_google_api: bool = False
    google_slides_id: str | None = None
    speed_profile: SpeedProfile = "balanced"
    workers: int | None = None
    checkpoint_every: int | None = None
    slide_range: tuple[int, int] | None = None
    max_slides: int | None = None
    max_questions: int | None = None
    reprocess_slide: int | None = None
    formatter_provider: Literal["openai"] = "openai"
    openai_model: str = "gpt-5.4"
    openai_reasoning_effort: ReasoningEffort = "high"
    openai_web_search: bool = True
    openai_target_rpm: int = 450
    openai_max_inflight: int = 120
    archive_current_format_state: bool = True
    quail_source_json: str | None = None
    quail_output_dir: str | None = None
    quail_images_dir: str | None = None
    quail_append: bool = False
    native_pack_dir: str | None = None
    native_pack_id: str | None = None
    native_title: str | None = None
    native_append: bool = False
    native_only_new: bool = False
    native_only_failed: bool = False
    native_reprocess_question: str | None = None
    dry_run_cost: bool = False
    dry_run: bool = False


@dataclass
class RunJobResult:
    """Job execution outcome."""

    success: bool
    job_type: str
    dry_run: bool
    summary: dict[str, Any] = field(default_factory=dict)
    artifacts: list[ArtifactRef] = field(default_factory=list)
    planned_actions: list[PlannedAction] = field(default_factory=list)
    logs: list[str] = field(default_factory=list)
    error_message: str | None = None
