from __future__ import annotations

from adapters.filesystem_adapter import FilesystemAdapter
from app.job_runner import run_job
from core.job_models import ArtifactRef, RunJobParams


class _DummyAdapter:
    def run(self, params, log):
        log(f"dummy adapter ran: {params.job_type}")
        return True, {"dummy": True}, [ArtifactRef(stage=params.job_type, kind="dummy", path="/tmp/dummy", exists=False)]


def test_job_runner_dry_run_returns_plan_without_writes(tmp_path):
    deck = tmp_path / "deck.pptx"
    deck.write_bytes(b"pptx")

    output_dir = tmp_path / "output"
    fs = FilesystemAdapter(output_dir)

    params = RunJobParams(job_type="extract", pptx_path=str(deck), dry_run=True)

    result = run_job(params, filesystem_adapter=fs)

    assert result.success is True
    assert result.dry_run is True
    assert len(result.planned_actions) > 0
    assert not (output_dir / "extracted_questions.json").exists()


def test_job_runner_executes_adapter_and_returns_logs(tmp_path):
    deck = tmp_path / "deck.pptx"
    deck.write_bytes(b"pptx")

    output_dir = tmp_path / "output"
    fs = FilesystemAdapter(output_dir)

    params = RunJobParams(job_type="extract", pptx_path=str(deck), dry_run=False)

    result = run_job(params, workflow_adapter=_DummyAdapter(), filesystem_adapter=fs)

    assert result.success is True
    assert result.summary["dummy"] is True
    assert any("dummy adapter ran" in line for line in result.logs)
    assert len(result.artifacts) == 1
