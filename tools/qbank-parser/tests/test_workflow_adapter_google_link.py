from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import adapters.workflow_adapter as workflow_adapter_module
from adapters.workflow_adapter import WorkflowAdapter
from core.job_models import RunJobParams


def test_extract_from_google_link_downloads_and_reuses_id(monkeypatch, tmp_path):
    output_dir = tmp_path / "output"
    output_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(workflow_adapter_module, "OUTPUT_DIR", output_dir)

    calls: dict[str, object] = {}

    def extract_presentation_id(raw_input: str) -> str:
        calls["extract_input"] = raw_input
        return "slides-file-id"

    def export_presentation_to_pptx(presentation_id: str, out_path: Path) -> Path:
        calls["export_id"] = presentation_id
        calls["export_path"] = str(out_path)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(b"pptx")
        return out_path

    def parse_presentation(
        pptx_path: str,
        use_ai: bool,
        use_google_api: bool,
        google_slides_id: str | None,
        generate_stats: bool,
            speed_profile: str,
            ai_workers: int | None,
            checkpoint_every: int | None,
            slide_range=None,
            max_slides=None,
            max_questions=None,
            reprocess_slide=None,
        ) -> bool:
        calls["parse_pptx_path"] = pptx_path
        calls["parse_use_google_api"] = use_google_api
        calls["parse_google_slides_id"] = google_slides_id
        return True

    workflows = SimpleNamespace(
        extract_presentation_id=extract_presentation_id,
        export_presentation_to_pptx=export_presentation_to_pptx,
        parse_presentation=parse_presentation,
    )

    adapter = WorkflowAdapter(workflows)
    params = RunJobParams(
        job_type="extract",
        google_slides_link="https://docs.google.com/presentation/d/slides-file-id/edit",
        with_google_api=False,
    )

    ok, summary, artifacts = adapter.run_extract(params, log=lambda _message: None)

    assert ok is True
    assert summary["success"] is True
    assert calls["extract_input"] == "https://docs.google.com/presentation/d/slides-file-id/edit"
    assert calls["export_id"] == "slides-file-id"
    assert str(calls["parse_pptx_path"]).endswith("_slides_downloads/slides-file-id.pptx")
    assert calls["parse_google_slides_id"] == "slides-file-id"
    assert calls["parse_use_google_api"] is True
    assert any(a.kind == "downloaded_pptx" for a in artifacts)
