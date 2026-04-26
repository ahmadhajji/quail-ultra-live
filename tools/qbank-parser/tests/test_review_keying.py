from __future__ import annotations

import json

from ai.gemini_processor import ExtractedQuestion
from export.csv_export import export_to_json, get_confirmed_questions
from review.terminal_ui import ReviewResult


def _make_question(slide: int, index: int, stem: str) -> ExtractedQuestion:
    return ExtractedQuestion(
        slide_number=slide,
        question_index=index,
        question_id=f"{slide}.{index}",
        is_valid_question=True,
        question_stem=stem,
        choices={"A": "Alpha", "B": "Beta"},
        correct_answer="A",
        correct_answer_text="Alpha",
        confidence=80,
    )


def test_export_to_json_applies_review_status_per_question_id(tmp_path):
    q1 = _make_question(8, 1, "Stem one")
    q2 = _make_question(8, 2, "Stem two")

    review_results = [
        ReviewResult(question_id="8.1", slide_number=8, question_index=1, status="edited", edited_data={"question_stem": "Edited stem one"}),
        ReviewResult(question_id="8.2", slide_number=8, question_index=2, status="skipped"),
    ]

    output_file = tmp_path / "reviewed.json"
    export_to_json([q1, q2], output_file, review_results=review_results)

    payload = json.loads(output_file.read_text(encoding="utf-8"))
    by_qid = {q["question_id"]: q for q in payload["questions"]}

    assert by_qid["8.1"]["review_status"] == "edited"
    assert by_qid["8.1"]["question_stem"] == "Edited stem one"
    assert by_qid["8.2"]["review_status"] == "skipped"
    assert by_qid["8.2"]["question_stem"] == "Stem two"


def test_get_confirmed_questions_respects_multi_question_variants():
    q1 = _make_question(8, 1, "Stem one")
    q2 = _make_question(8, 2, "Stem two")

    review_results = [
        ReviewResult(question_id="8.1", slide_number=8, question_index=1, status="confirmed"),
        ReviewResult(question_id="8.2", slide_number=8, question_index=2, status="skipped"),
    ]

    confirmed = get_confirmed_questions([q1, q2], review_results)
    assert len(confirmed) == 1
    assert confirmed[0].question_id == "8.1"
