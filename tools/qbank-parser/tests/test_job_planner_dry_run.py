from __future__ import annotations

from adapters.filesystem_adapter import FilesystemAdapter
from core.job_models import RunJobParams
from core.job_planner import build_job_plan


def test_quail_fresh_mode_plan_identifies_deletions(tmp_path):
    output_dir = tmp_path / "output"
    qbank = output_dir / "quail_qbank"
    qbank.mkdir(parents=True, exist_ok=True)
    (qbank / "001-q.html").write_text("q", encoding="utf-8")
    (qbank / "choices.json").write_text("{}", encoding="utf-8")

    source_json = output_dir / "usmle_formatted_questions.json"
    source_json.write_text('{"questions": []}', encoding="utf-8")

    fs = FilesystemAdapter(output_dir)
    params = RunJobParams(
        job_type="export_quail",
        quail_source_json=str(source_json),
        quail_output_dir=str(qbank),
        quail_append=False,
        dry_run=True,
    )

    actions = build_job_plan(params, fs)

    assert any(action.action == "delete" and action.path.endswith("001-q.html") for action in actions)
    assert any(action.action == "delete" and action.path.endswith("choices.json") for action in actions)


def test_format_plan_identifies_archive_moves(tmp_path):
    output_dir = tmp_path / "output"
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "extracted_questions.json").write_text('{"questions": []}', encoding="utf-8")
    (output_dir / "usmle_formatter_cache.json").write_text("{}", encoding="utf-8")

    fs = FilesystemAdapter(output_dir)
    params = RunJobParams(job_type="format", archive_current_format_state=True, dry_run=True)

    actions = build_job_plan(params, fs)

    assert any(action.action == "move" and action.path.endswith("usmle_formatter_cache.json") for action in actions)


def test_extract_plan_from_google_link_includes_download_action(tmp_path):
    output_dir = tmp_path / "output"
    output_dir.mkdir(parents=True, exist_ok=True)

    fs = FilesystemAdapter(output_dir)
    params = RunJobParams(
        job_type="extract",
        google_slides_link="https://docs.google.com/presentation/d/1AbCdeFgHiJkLmNoPqRsTuVwXyZ1234567890/edit",
        dry_run=True,
    )

    actions = build_job_plan(params, fs)

    assert any(action.action == "parse_link" for action in actions)
    assert any(
        action.action == "write" and action.path.endswith("_slides_downloads/1AbCdeFgHiJkLmNoPqRsTuVwXyZ1234567890.pptx")
        for action in actions
    )
