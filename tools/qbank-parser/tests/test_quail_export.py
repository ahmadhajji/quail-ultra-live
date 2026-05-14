import json
from pathlib import Path

import pytest
from PIL import Image

from export.quail_export import export_quail_qbank


def _write_image(path: Path, color: tuple[int, int, int], size: tuple[int, int] = (120, 120)) -> None:
    image = Image.new("RGB", size, color=color)
    image.save(path)


def _write_noise_image(path: Path, size: tuple[int, int] = (400, 400)) -> None:
    image = Image.effect_noise(size, 100).convert("RGB")
    image.save(path)


def _write_json(path: Path, questions: list[dict]) -> None:
    path.write_text(json.dumps({"questions": questions}, indent=2), encoding="utf-8")


def _make_templates(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)
    for name in ("lab_values.html", "calculator.html", "notes.html"):
        (path / name).write_text(f"<html><body>{name}</body></html>", encoding="utf-8")


def test_export_quail_qbank_filters_placeholder_images(tmp_path):
    source_dir = tmp_path / "source"
    output_dir = tmp_path / "qbank"
    images_dir = source_dir / "images"
    templates_dir = tmp_path / "templates"

    source_dir.mkdir(parents=True)
    images_dir.mkdir(parents=True)
    _make_templates(templates_dir)

    white_img = images_dir / "white.png"
    valid_img = images_dir / "valid.png"
    explain_img = images_dir / "explain.png"

    # Very white image should be filtered.
    _write_image(white_img, color=(255, 255, 255), size=(120, 120))
    _write_noise_image(valid_img, size=(400, 400))
    _write_noise_image(explain_img, size=(400, 400))
    assert valid_img.stat().st_size > 2048

    source_json = source_dir / "usmle_formatted_questions.json"
    _write_json(
        source_json,
        [
            {
                "question_id": "11",
                "review_status": "approved",
                "extraction_classification": "accepted",
                "question_stem": "A patient presents with chest pain.",
                "question": "What is the most likely diagnosis?",
                "choices": {
                    "A": "Stable angina",
                    "B": "NSTEMI",
                    "C": "GERD",
                    "D": "Pericarditis",
                },
                "correct_answer": "B",
                "correct_answer_explanation": "Troponin elevation supports NSTEMI.",
                "incorrect_explanations": {"A": "No acute marker rise."},
                "educational_objective": "Identify acute coronary syndrome.",
                "tags": {
                    "rotation": "Internal Medicine",
                    "discipline": "Cardiology",
                    "system": "Cardiovascular",
                },
                "images": [str(white_img), str(valid_img)],
                "explanation_images": [str(explain_img)],
            }
        ],
    )

    summary = export_quail_qbank(
        source_json=source_json,
        output_dir=output_dir,
        images_dir=images_dir,
        templates_dir=templates_dir,
        logger=lambda _message: None,
    )

    assert summary.questions_added == 1
    assert summary.total_questions == 1
    assert summary.total_source_images == 3
    assert summary.images_copied == 2
    assert summary.images_skipped == 1

    assert (output_dir / "001-q.html").exists()
    assert (output_dir / "001-s.html").exists()
    assert (output_dir / "001-img-1.png").exists()
    assert not (output_dir / "001-img-2.png").exists()
    assert (output_dir / "001-sol-img-1.png").exists()

    question_html = (output_dir / "001-q.html").read_text(encoding="utf-8")
    solution_html = (output_dir / "001-s.html").read_text(encoding="utf-8")
    assert "001-img-1.png" in question_html
    assert "001-sol-img-1.png" not in question_html
    assert "001-sol-img-1.png" in solution_html
    assert "001-img-1.png" not in solution_html

    choices = json.loads((output_dir / "choices.json").read_text(encoding="utf-8"))
    assert choices["001"]["correct"] == "B"

    tagnames = json.loads((output_dir / "tagnames.json").read_text(encoding="utf-8"))
    assert tagnames["tagnames"] == {"0": "Rotation", "1": "Topic"}

    index = json.loads((output_dir / "index.json").read_text(encoding="utf-8"))
    # Legacy system field should be used as topic fallback when topic is missing.
    assert index["001"]["0"] == "Internal Medicine"
    assert index["001"]["1"] == "Cardiovascular"


def test_export_quail_qbank_append_mode_continues_numbering(tmp_path):
    source_dir = tmp_path / "source"
    output_dir = tmp_path / "qbank"
    images_dir = source_dir / "images"
    templates_dir = tmp_path / "templates"

    source_dir.mkdir(parents=True)
    images_dir.mkdir(parents=True)
    _make_templates(templates_dir)

    valid_img = images_dir / "valid.png"
    _write_noise_image(valid_img, size=(400, 400))
    assert valid_img.stat().st_size > 2048

    first_json = source_dir / "first.json"
    second_json = source_dir / "second.json"

    _write_json(
        first_json,
        [
            {
                "question_id": "1",
                "review_status": "approved",
                "extraction_classification": "accepted",
                "question_stem": "First stem",
                "question": "First question?",
                "choices": {"A": "A1", "B": "B1"},
                "correct_answer": "A",
                "images": [str(valid_img)],
            }
        ],
    )
    _write_json(
        second_json,
        [
            {
                "question_id": "2",
                "review_status": "approved",
                "extraction_classification": "accepted",
                "question_stem": "Second stem",
                "question": "Second question?",
                "choices": {"A": "A2", "B": "B2"},
                "correct_answer": "B",
                "images": [str(valid_img)],
            }
        ],
    )

    export_quail_qbank(
        source_json=first_json,
        output_dir=output_dir,
        images_dir=images_dir,
        templates_dir=templates_dir,
        logger=lambda _message: None,
    )
    summary = export_quail_qbank(
        source_json=second_json,
        output_dir=output_dir,
        images_dir=images_dir,
        templates_dir=templates_dir,
        append=True,
        logger=lambda _message: None,
    )

    assert summary.questions_added == 1
    assert summary.total_questions == 2
    assert (output_dir / "001-q.html").exists()
    assert (output_dir / "002-q.html").exists()

    choices = json.loads((output_dir / "choices.json").read_text(encoding="utf-8"))
    assert set(choices.keys()) == {"001", "002"}

    tagnames = json.loads((output_dir / "tagnames.json").read_text(encoding="utf-8"))
    assert tagnames["tagnames"] == {"0": "Rotation", "1": "Topic"}


def test_export_quail_qbank_keeps_legacy_images_in_question_html(tmp_path):
    source_dir = tmp_path / "source"
    output_dir = tmp_path / "qbank"
    images_dir = source_dir / "images"
    templates_dir = tmp_path / "templates"

    source_dir.mkdir(parents=True)
    images_dir.mkdir(parents=True)
    _make_templates(templates_dir)

    valid_img = images_dir / "valid.png"
    _write_noise_image(valid_img, size=(400, 400))

    source_json = source_dir / "legacy.json"
    _write_json(
        source_json,
        [
            {
                "question_id": "1",
                "review_status": "approved",
                "extraction_classification": "accepted",
                "question_stem": "Legacy stem",
                "question": "Legacy question?",
                "choices": {"A": "A1", "B": "B1"},
                "correct_answer": "A",
                "images": [str(valid_img)],
            }
        ],
    )

    export_quail_qbank(
        source_json=source_json,
        output_dir=output_dir,
        images_dir=images_dir,
        templates_dir=templates_dir,
        logger=lambda _message: None,
    )

    question_html = (output_dir / "001-q.html").read_text(encoding="utf-8")
    solution_html = (output_dir / "001-s.html").read_text(encoding="utf-8")

    assert "001-img-1.png" in question_html
    assert "001-img-1.png" not in solution_html


def test_export_quail_qbank_writes_question_meta_sidecar(tmp_path):
    source_dir = tmp_path / "source"
    output_dir = tmp_path / "qbank"
    templates_dir = tmp_path / "templates"

    source_dir.mkdir(parents=True)
    _make_templates(templates_dir)

    source_slide_dir = source_dir / "rendered"
    source_slide_dir.mkdir(parents=True)
    source_slide = source_slide_dir / "slide.png"
    _write_noise_image(source_slide, size=(400, 400))

    source_json = source_dir / "usmle_formatted_questions.json"
    _write_json(
        source_json,
        [
            {
                "question_id": "deck-12.1",
                "review_status": "approved",
                "extraction_classification": "accepted",
                "original_slide_number": 12,
                "original_question_index": 1,
                "question_stem": "Stem",
                "question": "Question?",
                "choices": {"A": "Alpha", "B": "Bravo"},
                "correct_answer": "B",
                "deck_id": "../../escape",
                "source_group_id": "deck-12:12",
                "source_slide_path": str(source_slide),
                "slide_consensus_status": "consensus",
                "fact_check": {
                    "status": "confirmed",
                    "note": "Verified",
                    "sources": ["https://example.com/a"],
                    "model": "gpt-5.4",
                },
                "choice_text_by_letter": {"A": "Alpha", "B": "Bravo"},
                "choice_presentation": {"shuffle_allowed": True, "display_order": ["B", "A"]},
                "warnings": ["warn"],
                "related_question_ids": [],
                "dedupe_fingerprint": "deck-12:abc",
            }
        ],
    )

    export_quail_qbank(
        source_json=source_json,
        output_dir=output_dir,
        templates_dir=templates_dir,
        logger=lambda _message: None,
    )

    question_meta = json.loads((output_dir / "question-meta.json").read_text(encoding="utf-8"))
    assert question_meta["001"]["source"]["deck_id"] == "../../escape"
    assert question_meta["001"]["source_slide"]["expandable"] is True
    assert question_meta["001"]["fact_check"]["status"] == "confirmed"
    assert question_meta["001"]["choice_presentation"]["display_order"] == ["B", "A"]
    assert (output_dir / "source-slides" / "escape__slide_12.png").exists()
    assert ".." not in question_meta["001"]["source_slide"]["asset_path"]


def test_export_quail_qbank_rejects_media_paths_outside_allowed_roots(tmp_path):
    source_dir = tmp_path / "source"
    output_dir = tmp_path / "qbank"
    images_dir = source_dir / "images"
    templates_dir = tmp_path / "templates"
    outside_dir = tmp_path / "outside"

    source_dir.mkdir(parents=True)
    images_dir.mkdir(parents=True)
    outside_dir.mkdir(parents=True)
    _make_templates(templates_dir)

    secret = outside_dir / "secret.png"
    _write_noise_image(secret, size=(400, 400))

    source_json = source_dir / "formatted.json"
    _write_json(
        source_json,
        [
            {
                "question_id": "1",
                "review_status": "approved",
                "extraction_classification": "accepted",
                "question_stem": "Stem",
                "choices": {"A": "Alpha", "B": "Bravo"},
                "correct_answer": "A",
                "images": [str(secret)],
            }
        ],
    )

    with pytest.raises(ValueError, match="escapes allowed source roots"):
        export_quail_qbank(
            source_json=source_json,
            output_dir=output_dir,
            images_dir=images_dir,
            templates_dir=templates_dir,
            logger=lambda _message: None,
        )


def test_export_quail_qbank_blocks_disputed_items(tmp_path):
    source_dir = tmp_path / "source"
    output_dir = tmp_path / "qbank"
    templates_dir = tmp_path / "templates"

    source_dir.mkdir(parents=True)
    _make_templates(templates_dir)

    source_json = source_dir / "blocked.json"
    _write_json(
        source_json,
        [
            {
                "question_id": "blocked-1",
                "review_status": "approved",
                "extraction_classification": "accepted",
                "question_stem": "Stem",
                "question": "Question?",
                "choices": {"A": "Alpha", "B": "Bravo"},
                "correct_answer": "A",
                "fact_check": {"status": "disputed"},
            }
        ],
    )

    with pytest.raises(ValueError, match="blocked because unresolved or disputed items remain"):
        export_quail_qbank(
            source_json=source_json,
            output_dir=output_dir,
            templates_dir=templates_dir,
            logger=lambda _message: None,
        )
