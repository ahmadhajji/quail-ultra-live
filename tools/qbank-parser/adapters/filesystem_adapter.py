"""Filesystem planning helpers for dry-run previews."""

from __future__ import annotations

from pathlib import Path

from core.job_models import PlannedAction

PANE_FILES = ("lab_values.html", "calculator.html", "notes.html")


class FilesystemAdapter:
    """Repository-local filesystem inspection helpers."""

    def __init__(self, output_dir: Path):
        self.output_dir = output_dir.resolve()

    def _action(self, stage: str, action: str, path: Path, detail: str = "") -> PlannedAction:
        return PlannedAction(
            stage=stage,
            action=action,
            path=str(path.resolve()),
            exists=path.exists(),
            detail=detail,
        )

    def detect_format_source(self) -> Path | None:
        reviewed = self.output_dir / "reviewed_questions.json"
        extracted = self.output_dir / "extracted_questions.json"
        if reviewed.exists():
            return reviewed
        if extracted.exists():
            return extracted
        return None

    def downloaded_pptx_path(self, slides_id: str) -> Path:
        safe_id = "".join(ch for ch in slides_id if ch.isalnum() or ch in {"-", "_"})
        return self.output_dir / "_slides_downloads" / f"{safe_id or 'slides'}.pptx"

    def extract_actions(self, slides_id: str | None = None) -> list[PlannedAction]:
        actions = []
        if slides_id:
            actions.append(
                self._action(
                    "extract",
                    "write",
                    self.downloaded_pptx_path(slides_id),
                    "Backend-downloaded PPTX from Google Slides link",
                )
            )
        actions.extend([
            self._action("extract", "write", self.output_dir / "extracted_questions.json", "Extraction JSON output"),
            self._action("extract", "write", self.output_dir / "extracted_questions.csv", "Extraction CSV output"),
            self._action("extract", "write", self.output_dir / "extraction_progress.json", "Extraction resume checkpoint"),
            self._action("extract", "mkdir", self.output_dir / "extracted_images", "Image extraction folder"),
        ])
        return actions

    def format_actions(self, archive_current_state: bool) -> list[PlannedAction]:
        actions: list[PlannedAction] = []
        source = self.detect_format_source()
        if source is not None:
            actions.append(self._action("format", "read", source, "Formatting source JSON"))

        if archive_current_state:
            for path in [
                self.output_dir / "usmle_formatter_cache.json",
                self.output_dir / "usmle_formatter_progress.json",
                self.output_dir / "usmle_formatted_questions.json",
                self.output_dir / "usmle_formatted_questions.md",
            ]:
                if path.exists():
                    actions.append(self._action("format", "move", path, "Archive previous formatter artifact"))

        for path, detail in [
            (self.output_dir / "usmle_formatted_questions.json", "Formatted JSON"),
            (self.output_dir / "usmle_formatted_questions.md", "Formatted Markdown"),
            (self.output_dir / "usmle_formatter_cache.json", "Formatter cache"),
            (self.output_dir / "usmle_formatter_progress.json", "Formatter progress"),
            (self.output_dir / "usmle_failed_questions.json", "Formatting failures output"),
        ]:
            actions.append(self._action("format", "write", path, detail))

        return actions

    def quail_actions(
        self,
        source_json: str | None,
        output_dir: str | None,
        images_dir: str | None,
        append: bool,
    ) -> list[PlannedAction]:
        actions: list[PlannedAction] = []
        source_path = Path(source_json).resolve() if source_json else (self.output_dir / "usmle_formatted_questions.json")
        target_dir = Path(output_dir).resolve() if output_dir else (self.output_dir / "quail_qbank")
        images_path = Path(images_dir).resolve() if images_dir else (source_path.parent / "extracted_images")

        actions.append(self._action("export_quail", "read", source_path, "Quail source JSON"))
        actions.append(self._action("export_quail", "mkdir", target_dir, "Quail output directory"))
        actions.append(self._action("export_quail", "read", images_path, "Images source directory"))

        if not append and target_dir.exists():
            for pattern in ("*-q.html", "*-s.html", "*-img-*.png"):
                for file_path in sorted(target_dir.glob(pattern)):
                    actions.append(self._action("export_quail", "delete", file_path, "Fresh-mode cleanup"))
            for filename in (
                "choices.json",
                "index.json",
                "tagnames.json",
                "groups.json",
                "panes.json",
                *PANE_FILES,
            ):
                path = target_dir / filename
                if path.exists():
                    actions.append(self._action("export_quail", "delete", path, "Fresh-mode cleanup"))

        for filename in (
            "choices.json",
            "index.json",
            "tagnames.json",
            "groups.json",
            "panes.json",
            *PANE_FILES,
        ):
            actions.append(self._action("export_quail", "write", target_dir / filename, "Quail metadata/template output"))

        return actions

    def full_pipeline_actions(
        self,
        *,
        pptx_path: str | None,
        slides_id: str | None,
        archive_current_state: bool,
        source_json: str | None,
        output_dir: str | None,
        images_dir: str | None,
        append: bool,
    ) -> list[PlannedAction]:
        actions: list[PlannedAction] = []
        if pptx_path:
            actions.append(self._action("extract", "read", Path(pptx_path), "Input PPTX file"))
        actions.extend(self.extract_actions(slides_id=slides_id))
        actions.extend(self.format_actions(archive_current_state))
        actions.extend(self.quail_actions(source_json, output_dir, images_dir, append))
        return actions
