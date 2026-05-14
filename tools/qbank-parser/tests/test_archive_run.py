from __future__ import annotations

import archive_run
import pytest


def test_has_content_ignores_placeholder_files(monkeypatch, tmp_path):
    data_dir = tmp_path / "data"
    output_dir = tmp_path / "output"
    extracted_dir = output_dir / "extracted_images"
    data_dir.mkdir(parents=True, exist_ok=True)
    extracted_dir.mkdir(parents=True, exist_ok=True)

    (data_dir / ".gitkeep").touch()
    (output_dir / ".gitkeep").touch()
    (output_dir / ".DS_Store").touch()
    (extracted_dir / ".gitkeep").touch()

    monkeypatch.setattr(archive_run, "DATA_DIR", data_dir)
    monkeypatch.setattr(archive_run, "OUTPUT_DIR", output_dir)

    assert archive_run.has_content() is False


def test_has_content_detects_real_files(monkeypatch, tmp_path):
    data_dir = tmp_path / "data"
    output_dir = tmp_path / "output"
    data_dir.mkdir(parents=True, exist_ok=True)
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "extracted_questions.json").write_text("{}", encoding="utf-8")

    monkeypatch.setattr(archive_run, "DATA_DIR", data_dir)
    monkeypatch.setattr(archive_run, "OUTPUT_DIR", output_dir)

    assert archive_run.has_content() is True


def test_archive_run_rejects_traversal_names(monkeypatch, tmp_path):
    archives_dir = tmp_path / "archives"
    monkeypatch.setattr(archive_run, "ARCHIVES_DIR", archives_dir)

    for name in ("", ".", ".."):
        with pytest.raises(ValueError):
            archive_run.archive_run(name)
