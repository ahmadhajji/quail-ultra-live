from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

import main
from export.quail_repair import QuailRepairSummary, _score_image_text, repair_quail_qbank_images


def _write_quail_fixture(base: Path) -> None:
    base.mkdir(parents=True, exist_ok=True)
    (base / "choices.json").write_text(
        json.dumps({"001": {"options": ["A", "B", "C", "D", "E"], "correct": "B"}}, indent=2),
        encoding="utf-8",
    )
    (base / "index.json").write_text(json.dumps({"001": {"0": "OB-GYN", "1": "Topic"}}, indent=2), encoding="utf-8")
    (base / "groups.json").write_text("{}", encoding="utf-8")
    (base / "tagnames.json").write_text(json.dumps({"tagnames": {"0": "Rotation", "1": "Topic"}}, indent=2), encoding="utf-8")
    (base / "panes.json").write_text(json.dumps({"Notes": {"file": "notes.html"}}, indent=2), encoding="utf-8")
    (base / "notes.html").write_text("<html><body>Notes</body></html>", encoding="utf-8")
    (base / "001-q.html").write_text(
        """<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head><body>
<p>A patient presents with chest pain.</p>
<p><strong>What is the most likely diagnosis?</strong></p>
<p><img src="./001-img-1.png"></p>
<p><img src="./001-img-2.png"></p>
<p>
A) Stable angina<br>
B) NSTEMI<br>
C) GERD<br>
D) Pericarditis<br>
E) Panic attack<br>
</p>
</body></html>""",
        encoding="utf-8",
    )
    (base / "001-s.html").write_text(
        """<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head><body>
<p><strong>Correct Answer: B</strong></p>
<p><strong>Explanation:</strong><br>Troponin elevation supports NSTEMI.</p>
<p><strong>Why other answers are incorrect:</strong></p>
<ul><li><strong>A:</strong> No acute marker rise.</li></ul>
</body></html>""",
        encoding="utf-8",
    )
    (base / "001-img-1.png").write_bytes(b"png-1")
    (base / "001-img-2.png").write_bytes(b"png-2")


def test_score_image_text_moves_explicit_correct_answer() -> None:
    decision = _score_image_text(
        ocr_text="Correct Answer: D. The diagnosis is ectopic pregnancy.",
        correct_letter="D",
        correct_choice_text="Ectopic pregnancy",
        prompt_text="Which diagnosis is most likely?",
    )

    assert decision.destination == "solution"
    assert decision.score >= 4
    assert any("answer_cue" in rule for rule in decision.rule_hits)


def test_score_image_text_moves_exact_correct_choice_match() -> None:
    decision = _score_image_text(
        ocr_text="NSTEMI",
        correct_letter="B",
        correct_choice_text="NSTEMI",
        prompt_text="What is the most likely diagnosis?",
    )

    assert decision.destination == "solution"
    assert "exact_correct_choice_match" in decision.rule_hits


def test_score_image_text_keeps_no_meaningful_text() -> None:
    decision = _score_image_text(
        ocr_text="  ",
        correct_letter="A",
        correct_choice_text="Stable angina",
        prompt_text="What is the diagnosis?",
    )

    assert decision.destination == "question"
    assert decision.rule_hits == ["no_meaningful_text"]


def test_score_image_text_keeps_plain_stem_like_text() -> None:
    decision = _score_image_text(
        ocr_text="4 cm\n80% effaced\nstation +1",
        correct_letter="D",
        correct_choice_text="Perform artificial rupture of membranes",
        prompt_text="A primigravid patient has a cervical exam shown in the image with 4 cm dilation, 80% effacement, and station +1.",
    )

    assert decision.destination == "question"
    assert decision.stem_score >= 2


def test_repair_quail_qbank_images_copies_source_and_moves_solution_images(tmp_path: Path) -> None:
    source_dir = tmp_path / "source-qbank"
    output_dir = tmp_path / "adjusted-qbank"
    _write_quail_fixture(source_dir)

    ocr_by_name = {
        "001-img-1.png": "Correct Answer: B NSTEMI",
        "001-img-2.png": "",
    }

    summary = repair_quail_qbank_images(
        source_dir=source_dir,
        output_dir=output_dir,
        ocr_text_fn=lambda path: ocr_by_name[path.name],
        logger=lambda _message: None,
    )

    assert summary.questions_scanned == 1
    assert summary.images_scanned == 2
    assert summary.images_moved == 1
    assert summary.images_kept == 1

    source_question_html = (source_dir / "001-q.html").read_text(encoding="utf-8")
    assert "001-img-1.png" in source_question_html
    assert (source_dir / "001-img-1.png").exists()

    adjusted_question_html = (output_dir / "001-q.html").read_text(encoding="utf-8")
    adjusted_solution_html = (output_dir / "001-s.html").read_text(encoding="utf-8")
    assert "001-img-1.png" not in adjusted_question_html
    assert "001-img-2.png" in adjusted_question_html
    assert "001-sol-img-1.png" in adjusted_solution_html
    assert "Why other answers are incorrect" in adjusted_solution_html
    assert (output_dir / "001-sol-img-1.png").exists()
    assert not (output_dir / "001-img-1.png").exists()

    assert (output_dir / "index.json").read_text(encoding="utf-8") == (source_dir / "index.json").read_text(encoding="utf-8")
    assert (output_dir / "tagnames.json").read_text(encoding="utf-8") == (source_dir / "tagnames.json").read_text(encoding="utf-8")

    report = json.loads((output_dir / "repair_report.json").read_text(encoding="utf-8"))
    assert report["images_moved"] == 1
    assert report["audit_entries"][0]["final_destination"] == "solution"


def test_repair_quail_qbank_images_dry_run_does_not_write_output(tmp_path: Path) -> None:
    source_dir = tmp_path / "source-qbank"
    output_dir = tmp_path / "planned-output"
    _write_quail_fixture(source_dir)

    summary = repair_quail_qbank_images(
        source_dir=source_dir,
        output_dir=output_dir,
        dry_run=True,
        ocr_text_fn=lambda path: "Correct Answer: B NSTEMI" if path.name == "001-img-1.png" else "",
        logger=lambda _message: None,
    )

    assert summary.dry_run is True
    assert summary.output_dir == output_dir.resolve()
    assert not output_dir.exists()


def test_repair_quail_qbank_images_requires_choices_json(tmp_path: Path) -> None:
    source_dir = tmp_path / "source-qbank"
    source_dir.mkdir()

    with pytest.raises(FileNotFoundError):
        repair_quail_qbank_images(source_dir=source_dir, output_dir=tmp_path / "out", logger=lambda _message: None)


def test_repair_quail_qbank_images_skips_missing_html(tmp_path: Path) -> None:
    source_dir = tmp_path / "source-qbank"
    source_dir.mkdir()
    (source_dir / "choices.json").write_text(json.dumps({"001": {"correct": "A"}}), encoding="utf-8")

    summary = repair_quail_qbank_images(
        source_dir=source_dir,
        output_dir=tmp_path / "out",
        dry_run=True,
        logger=lambda _message: None,
        ocr_text_fn=lambda _path: "",
    )

    assert summary.questions_scanned == 1
    assert summary.images_scanned == 0
    assert summary.audit_entries == []


def test_repair_quail_qbank_images_leaves_missing_image_in_place(tmp_path: Path) -> None:
    source_dir = tmp_path / "source-qbank"
    source_dir.mkdir()
    (source_dir / "choices.json").write_text(json.dumps({"001": {"correct": "A"}}), encoding="utf-8")
    (source_dir / "001-q.html").write_text(
        '<html><body><p>Stem</p><p><img src="./001-img-1.png"></p><p>A) One<br>B) Two<br></p></body></html>',
        encoding="utf-8",
    )
    (source_dir / "001-s.html").write_text("<html><body></body></html>", encoding="utf-8")

    summary = repair_quail_qbank_images(
        source_dir=source_dir,
        output_dir=tmp_path / "out",
        dry_run=True,
        logger=lambda _message: None,
        ocr_text_fn=lambda _path: "",
    )

    assert summary.questions_scanned == 1
    assert summary.images_scanned == 0
    assert summary.audit_entries == []


def test_main_repair_quail_cli_uses_default_output_dir(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    source_dir = tmp_path / "source-qbank"
    source_dir.mkdir()
    expected_output = tmp_path / "expected-output"
    captured: dict[str, object] = {}

    monkeypatch.setattr(main, "default_repair_output_dir", lambda _source: expected_output)

    def fake_repair(source_dir, output_dir, *, dry_run, logger):
        captured["source_dir"] = source_dir
        captured["output_dir"] = output_dir
        captured["dry_run"] = dry_run
        return QuailRepairSummary(
            source_dir=Path(source_dir),
            output_dir=Path(output_dir),
            dry_run=dry_run,
        )

    monkeypatch.setattr(main, "repair_quail_qbank_images", fake_repair)
    monkeypatch.setattr(sys, "argv", ["main.py", "--repair-quail-dir", str(source_dir), "--dry-run"])

    main.main()

    assert captured == {
        "source_dir": str(source_dir),
        "output_dir": expected_output,
        "dry_run": True,
    }


def test_main_repair_quail_cli_exits_on_missing_choices(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    source_dir = tmp_path / "source-qbank"
    source_dir.mkdir()
    output_dir = tmp_path / "adjusted-qbank"
    monkeypatch.setattr(
        sys,
        "argv",
        ["main.py", "--repair-quail-dir", str(source_dir), "--repair-output-dir", str(output_dir)],
    )

    with pytest.raises(SystemExit) as exc_info:
        main.main()

    assert exc_info.value.code == 1
    output = capsys.readouterr().out
    assert "Quail repair failed" in output
