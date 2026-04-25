from __future__ import annotations

import json

import pytest

from domain.models import ExtractedQuestion
from export.csv_export import export_to_json
from storage.run_repository import RunRepository


def test_atomic_write_json_replaces_and_cleans_temp(tmp_path):
    repo = RunRepository()
    target = tmp_path / "state.json"
    target.write_text('{"old": true}', encoding="utf-8")

    repo.atomic_write_json(target, {"new": True})

    payload = json.loads(target.read_text(encoding="utf-8"))
    assert payload == {"new": True}
    assert list(tmp_path.glob("state.json.tmp.*")) == []


def test_atomic_write_json_recovers_when_replace_fails(monkeypatch, tmp_path):
    repo = RunRepository()
    target = tmp_path / "state.json"
    target.write_text('{"old": true}', encoding="utf-8")

    def fail_replace(_src, _dst):
        raise OSError("replace failed")

    monkeypatch.setattr("storage.run_repository.os.replace", fail_replace)

    with pytest.raises(OSError, match="replace failed"):
        repo.atomic_write_json(target, {"new": True})

    payload = json.loads(target.read_text(encoding="utf-8"))
    assert payload == {"old": True}
    assert list(tmp_path.glob("state.json.tmp.*")) == []


def test_extracted_questions_schema_contract_round_trip(tmp_path):
    repo = RunRepository()
    output_path = tmp_path / "extracted_questions.json"
    questions = [
        ExtractedQuestion(
            slide_number=4,
            question_index=2,
            question_id="4.2",
            is_valid_question=True,
            question_stem="Sample stem",
            choices={"A": "One", "B": "Two"},
            correct_answer="B",
            correct_answer_text="Two",
            confidence=88,
            explanation_images=["/tmp/explainer.png"],
            comments=[{"author": "Reviewer", "content": "Looks good"}],
        )
    ]

    export_to_json(questions, output_path)
    payload = repo.load_json(output_path)
    restored = repo.load_extracted_questions(output_path)

    assert set(payload.keys()) == {"export_date", "total_slides", "valid_questions", "question_counts", "questions"}
    assert payload["questions"][0]["question_id"] == "4.2"
    assert payload["questions"][0]["review_status"] == "approved"
    assert payload["questions"][0]["explanation_images"] == ["/tmp/explainer.png"]
    assert len(restored) == 1
    assert restored[0].question_id == "4.2"
    assert restored[0].explanation_images == ["/tmp/explainer.png"]
    assert restored[0].comments == [{"author": "Reviewer", "content": "Looks good"}]
