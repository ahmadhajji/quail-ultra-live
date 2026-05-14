import json
from pathlib import Path

import pytest
from PIL import Image

from export.native_contract import validate_native_pack_directory
from export.native_quail_export import export_native_quail_qbank


def _write_noise_image(path: Path, size: tuple[int, int] = (220, 180)) -> None:
    image = Image.effect_noise(size, 100).convert("RGB")
    image.save(path)


def _write_json(path: Path, questions: list[dict]) -> None:
    path.write_text(json.dumps({"questions": questions}, indent=2), encoding="utf-8")


def test_export_native_quail_qbank_writes_structured_pack(tmp_path):
    source_dir = tmp_path / "source"
    output_dir = tmp_path / "native"
    images_dir = source_dir / "images"
    source_dir.mkdir(parents=True)
    images_dir.mkdir(parents=True)

    stem_image = images_dir / "stem.png"
    explanation_image = images_dir / "explanation.png"
    source_slide = source_dir / "slide.png"
    _write_noise_image(stem_image)
    _write_noise_image(explanation_image)
    _write_noise_image(source_slide)

    source_json = source_dir / "formatted.json"
    _write_json(
        source_json,
        [
            {
                "question_id": "peds.deck.s012.q01",
                "review_status": "approved",
                "extraction_classification": "accepted",
                "original_slide_number": 12,
                "original_question_index": 1,
                "question_stem": "A child has fever and focal crackles.",
                "question": "Which organism is most likely?",
                "choices": {
                    "A": "Respiratory syncytial virus",
                    "B": "Streptococcus pneumoniae",
                    "C": "Mycoplasma pneumoniae",
                    "D": "Bordetella pertussis",
                },
                "correct_answer": "B",
                "correct_answer_explanation": "Typical bacterial pneumonia is commonly pneumococcal.",
                "incorrect_explanations": {"A": "RSV causes bronchiolitis."},
                "educational_objective": "Recognize typical pediatric pneumonia.",
                "tags": {
                    "rotation": "Pediatrics",
                    "subject": "Pulmonology",
                    "system": "Respiratory",
                    "topic": "Pneumonia",
                },
                "images": [str(stem_image)],
                "explanation_images": [str(explanation_image)],
                "deck_id": "peds-deck",
                "source_slide_path": str(source_slide),
                "source_group_id": "peds-deck:12",
                "fact_check": {"status": "confirmed", "sources": ["fixture-source"]},
                "warnings": [],
                "dedupe_fingerprint": "peds-pneumonia",
            }
        ],
    )

    summary = export_native_quail_qbank(
        source_json=source_json,
        output_dir=output_dir,
        pack_id="pediatrics",
        title="Pediatrics",
        images_dir=images_dir,
        logger=lambda _message: None,
    )

    assert summary.questions_written == 1
    assert summary.total_questions == 1
    assert summary.media_files_copied == 3
    assert validate_native_pack_directory(output_dir) == []

    manifest = json.loads((output_dir / "quail-ultra-pack.json").read_text(encoding="utf-8"))
    question_path = output_dir / manifest["questionIndex"][0]["path"]
    question = json.loads(question_path.read_text(encoding="utf-8"))

    assert manifest["format"] == "quail-ultra-qbank"
    correct_choice_id = manifest["questionIndex"][0]["answerSummary"]["correctChoiceId"]
    assert question["answerKey"]["correctChoiceId"] == correct_choice_id
    assert next(choice for choice in question["choices"] if choice["id"] == correct_choice_id)["text"][0]["text"] == "Streptococcus pneumoniae"
    assert any(block.get("mediaId", "").endswith(".stem.1") for block in question["stem"]["blocks"])
    assert any(block.get("mediaId", "").endswith(".explanation.1") for block in question["explanation"]["correct"])
    assert {media["role"] for media in question["media"]} == {"stem", "explanation", "source_slide"}
    assert (output_dir / "pack_state.json").exists()


def test_export_native_quail_qbank_includes_disputed_questions_with_warning(tmp_path):
    source_json = tmp_path / "blocked.json"
    _write_json(
        source_json,
        [
            {
                "question_id": "blocked",
                "review_status": "approved",
                "extraction_classification": "accepted",
                "question_stem": "Stem",
                "choices": {"A": "Alpha", "B": "Bravo"},
                "correct_answer": "A",
                "fact_check": {"status": "disputed"},
            }
        ],
    )

    output_dir = tmp_path / "native"
    summary = export_native_quail_qbank(
        source_json=source_json,
        output_dir=output_dir,
        pack_id="pediatrics",
        logger=lambda _message: None,
    )

    manifest = json.loads((output_dir / "quail-ultra-pack.json").read_text(encoding="utf-8"))
    question = json.loads((output_dir / manifest["questionIndex"][0]["path"]).read_text(encoding="utf-8"))
    report = json.loads(summary.qa_report_json.read_text(encoding="utf-8"))

    assert summary.questions_added == 1
    assert any("Fact-check status is disputed" in warning for warning in question["quality"]["warnings"])
    assert report["warningQuestions"]


def test_export_native_quail_qbank_append_skips_unchanged_and_updates_changed(tmp_path):
    source_json = tmp_path / "formatted.json"
    output_dir = tmp_path / "native"
    base_question = {
        "review_status": "approved",
        "extraction_classification": "accepted",
        "deck_id": "peds-deck",
        "original_slide_number": 10,
        "original_question_index": 1,
        "question_stem": "Initial stem",
        "choices": {"A": "Alpha", "B": "Bravo"},
        "correct_answer": "A",
        "correct_answer_explanation": "Initial explanation",
        "tags": {"rotation": "Pediatrics", "topic": "Sample"},
    }
    _write_json(source_json, [base_question])

    first = export_native_quail_qbank(
        source_json=source_json,
        output_dir=output_dir,
        pack_id="pediatrics",
        logger=lambda _message: None,
    )
    unchanged = export_native_quail_qbank(
        source_json=source_json,
        output_dir=output_dir,
        pack_id="pediatrics",
        append=True,
        logger=lambda _message: None,
    )

    changed_question = {**base_question, "educational_objective": "A changed educational objective must update append output."}
    _write_json(source_json, [changed_question])
    changed = export_native_quail_qbank(
        source_json=source_json,
        output_dir=output_dir,
        pack_id="pediatrics",
        append=True,
        logger=lambda _message: None,
    )

    assert first.questions_added == 1
    assert unchanged.questions_skipped == 1
    assert changed.questions_updated == 1

    manifest = json.loads((output_dir / "quail-ultra-pack.json").read_text(encoding="utf-8"))
    assert manifest["revision"]["number"] == 3
    assert len(manifest["questionIndex"]) == 1
    qid = manifest["questionIndex"][0]["id"]
    assert qid == "pediatrics.peds-deck.s010.q01"

    state = json.loads((output_dir / "pack_state.json").read_text(encoding="utf-8"))
    assert state["questions"]["peds-deck:10:1:"]["questionId"] == qid
    assert [entry["action"] for entry in state["history"]] == ["added", "skipped", "updated"]


def test_export_native_quail_qbank_filters_by_slide_range_and_max_questions(tmp_path):
    source_json = tmp_path / "formatted.json"
    output_dir = tmp_path / "native"
    questions = []
    for slide in range(1, 6):
        questions.append(
            {
                "review_status": "approved",
                "extraction_classification": "accepted",
                "deck_id": "peds-deck",
                "original_slide_number": slide,
                "original_question_index": 1,
                "question_stem": f"Stem {slide}",
                "choices": {"A": "Alpha", "B": "Bravo"},
                "correct_answer": "A",
                "correct_answer_explanation": "Because",
                "tags": {"rotation": "Pediatrics", "topic": "Sample"},
            }
        )
    _write_json(source_json, questions)

    summary = export_native_quail_qbank(
        source_json=source_json,
        output_dir=output_dir,
        pack_id="pediatrics",
        slide_range=(2, 5),
        max_questions=2,
        logger=lambda _message: None,
    )

    manifest = json.loads((output_dir / "quail-ultra-pack.json").read_text(encoding="utf-8"))
    assert summary.questions_added == 2
    assert [entry["source"]["slideNumber"] for entry in manifest["questionIndex"]] == [2, 3]


def test_export_native_quail_qbank_blocks_conflicting_duplicate_fingerprints(tmp_path):
    source_json = tmp_path / "formatted.json"
    output_dir = tmp_path / "native"
    _write_json(
        source_json,
        [
            {
                "review_status": "approved",
                "extraction_classification": "accepted",
                "deck_id": "peds-deck",
                "original_slide_number": 1,
                "original_question_index": 1,
                "question_stem": "Duplicate stem",
                "choices": {"A": "Alpha", "B": "Bravo"},
                "correct_answer": "A",
                "correct_answer_explanation": "Because",
                "tags": {"rotation": "Pediatrics", "topic": "Sample"},
                "dedupe_fingerprint": "same-question",
            },
            {
                "review_status": "approved",
                "extraction_classification": "accepted",
                "deck_id": "peds-deck",
                "original_slide_number": 2,
                "original_question_index": 1,
                "question_stem": "Duplicate stem",
                "choices": {"A": "Alpha", "B": "Bravo"},
                "correct_answer": "B",
                "correct_answer_explanation": "Because",
                "tags": {"rotation": "Pediatrics", "topic": "Sample"},
                "dedupe_fingerprint": "same-question",
            },
        ],
    )

    with pytest.raises(ValueError, match="conflicting answers"):
        export_native_quail_qbank(
            source_json=source_json,
            output_dir=output_dir,
            pack_id="pediatrics",
            logger=lambda _message: None,
        )


def test_export_native_quail_qbank_rejects_unsafe_media_paths(tmp_path):
    source_dir = tmp_path / "source"
    outside_dir = tmp_path / "outside"
    output_dir = tmp_path / "native"
    source_dir.mkdir(parents=True)
    outside_dir.mkdir(parents=True)
    outside_image = outside_dir / "secret.png"
    _write_noise_image(outside_image)

    source_json = source_dir / "formatted.json"
    _write_json(
        source_json,
        [
            {
                "question_id": "unsafe",
                "review_status": "approved",
                "extraction_classification": "accepted",
                "deck_id": "peds-deck",
                "original_slide_number": 1,
                "question_stem": "Stem",
                "choices": {"A": "Alpha", "B": "Bravo"},
                "correct_answer": "A",
                "images": [str(outside_image)],
                "tags": {"rotation": "Pediatrics", "topic": "Sample"},
            }
        ],
    )

    with pytest.raises(ValueError, match="failed validation"):
        export_native_quail_qbank(
            source_json=source_json,
            output_dir=output_dir,
            pack_id="pediatrics",
            logger=lambda _message: None,
        )
    report = json.loads((output_dir / "validation" / "native_sample_report.json").read_text(encoding="utf-8"))
    assert "escapes allowed source roots" in report["excluded"][0]["reason"]


def test_export_native_quail_qbank_strips_bat_markers_and_reports_exclusions(tmp_path):
    source_json = tmp_path / "formatted.json"
    output_dir = tmp_path / "native"
    _write_json(
        source_json,
        [
            {
                "question_id": "bat",
                "review_status": "approved",
                "extraction_classification": "accepted",
                "deck_id": "peds-deck",
                "original_slide_number": 1,
                "question_stem": "BAT24 Which finding is expected?",
                "choices": {"A": "BAT25", "B": "Real answer", "C": "Distractor"},
                "correct_answer": "B",
                "correct_answer_explanation": "BAT26 Because it is correct.",
                "educational_objective": "BAT27 Learn the concept.",
                "tags": {"rotation": "Pediatrics", "topic": "Sample"},
            },
            {
                "question_id": "error",
                "extraction_classification": "error",
                "slide_number": 2,
                "error": "not detected as question slide",
            },
        ],
    )

    summary = export_native_quail_qbank(
        source_json=source_json,
        output_dir=output_dir,
        pack_id="pediatrics",
        logger=lambda _message: None,
    )

    manifest = json.loads((output_dir / "quail-ultra-pack.json").read_text(encoding="utf-8"))
    question = json.loads((output_dir / manifest["questionIndex"][0]["path"]).read_text(encoding="utf-8"))
    packed = json.dumps(question)
    report = json.loads(summary.qa_report_json.read_text(encoding="utf-8"))

    assert "BAT" not in packed
    assert report["excludedQuestionCount"] == 1
    assert report["batMarkerFindings"]["sourceRecordsWithBatMarkers"] == 1
