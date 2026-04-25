from __future__ import annotations

import json

from ai.gemini_processor import ExtractedQuestion
from export.csv_export import export_to_json


def test_export_to_json_records_unique_slide_count(tmp_path):
    output_path = tmp_path / "extracted_questions.json"
    questions = [
        ExtractedQuestion(
            slide_number=5,
            question_index=1,
            is_valid_question=True,
            question_stem="Q1",
            choices={"A": "a", "B": "b", "C": "c", "D": "d"},
            correct_answer="A",
            correct_answer_text="a",
            confidence=90,
        ),
        ExtractedQuestion(
            slide_number=5,
            question_index=2,
            is_valid_question=True,
            question_stem="Q2",
            choices={"A": "a", "B": "b", "C": "c", "D": "d"},
            correct_answer="B",
            correct_answer_text="b",
            confidence=88,
        ),
        ExtractedQuestion(
            slide_number=7,
            question_index=1,
            is_valid_question=False,
            error="not a question",
        ),
    ]

    export_to_json(questions, output_path)
    payload = json.loads(output_path.read_text(encoding="utf-8"))

    assert payload["total_slides"] == 2
    assert payload["valid_questions"] == 2
