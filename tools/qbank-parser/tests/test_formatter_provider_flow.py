from __future__ import annotations

import json
from pathlib import Path

import main


def test_archive_formatter_state_moves_files_and_writes_manifest(monkeypatch, tmp_path):
    monkeypatch.setattr(main, "OUTPUT_DIR", tmp_path)

    files = [
        "usmle_formatter_cache.json",
        "usmle_formatter_progress.json",
        "usmle_formatted_questions.json",
    ]
    for name in files:
        (tmp_path / name).write_text("{}", encoding="utf-8")

    backup_dir = main.archive_formatter_state("openai")

    assert backup_dir is not None
    assert backup_dir.exists()
    for name in files:
        assert not (tmp_path / name).exists()
        assert (backup_dir / name).exists()

    manifest = json.loads((backup_dir / "backup_manifest.json").read_text(encoding="utf-8"))
    assert manifest["provider"] == "openai"
    assert manifest["moved_file_count"] == len(files)
    assert sorted(manifest["source_filenames"]) == sorted(files)
    assert len(manifest["moved_files"]) == len(files)


def test_format_questions_openai_requires_key(monkeypatch):
    monkeypatch.setattr(main, "OPENAI_API_KEY", "")

    try:
        main.format_questions_to_usmle_outputs(
            questions=[],
            formatter_provider="openai",
            archive_current_format_state=False,
        )
    except RuntimeError as e:
        assert "OPENAI_API_KEY" in str(e)
    else:
        raise AssertionError("Expected RuntimeError when OPENAI_API_KEY is missing")
