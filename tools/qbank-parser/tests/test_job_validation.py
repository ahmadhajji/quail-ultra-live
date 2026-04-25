from __future__ import annotations

from adapters.filesystem_adapter import FilesystemAdapter
from core.job_models import RunJobParams
from core.job_validation import validate_run_params


def test_extract_requires_pptx_path(tmp_path):
    fs = FilesystemAdapter(tmp_path / "output")
    params = RunJobParams(job_type="extract", pptx_path=None)

    errors = validate_run_params(params, fs)

    assert any("either pptx_path or google_slides_link" in error for error in errors)


def test_export_requires_existing_source_json(tmp_path):
    fs = FilesystemAdapter(tmp_path / "output")
    params = RunJobParams(
        job_type="export_quail",
        quail_source_json=str((tmp_path / "missing.json").resolve()),
    )

    errors = validate_run_params(params, fs)

    assert any("Quail source JSON not found" in error for error in errors)


def test_extract_accepts_google_slides_link_without_pptx(tmp_path):
    fs = FilesystemAdapter(tmp_path / "output")
    params = RunJobParams(
        job_type="extract",
        pptx_path=None,
        google_slides_link="https://docs.google.com/presentation/d/1AbCdeFgHiJkLmNoPqRsTuVwXyZ1234567890/edit",
    )

    errors = validate_run_params(params, fs)

    assert errors == []
