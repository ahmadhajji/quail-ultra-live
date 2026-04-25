from __future__ import annotations

from ai.gemini_processor import ExtractedQuestion
from export.usmle_formatter import USMLEFormatter, USMLEQuestion


def test_format_batch_preserves_multi_question_ids(monkeypatch):
    formatter = USMLEFormatter.__new__(USMLEFormatter)
    captured_ids: list[str] = []

    def fake_format_question(self, question: ExtractedQuestion, question_id: str | int, retries: int = 3):
        normalized_id = str(question_id)
        captured_ids.append(normalized_id)
        return USMLEQuestion(
            original_slide_number=question.slide_number,
            question_id=normalized_id,
        )

    monkeypatch.setattr(USMLEFormatter, "format_question", fake_format_question)

    questions = [
        ExtractedQuestion(slide_number=12, question_index=1, question_id="12.1"),
        ExtractedQuestion(slide_number=12, question_index=2, question_id="12.2"),
    ]

    results = USMLEFormatter.format_batch(formatter, questions)

    assert captured_ids == ["12.1", "12.2"]
    assert [q.question_id for q in results] == ["12.1", "12.2"]


def test_format_batch_rejects_duplicate_question_ids():
    formatter = USMLEFormatter.__new__(USMLEFormatter)
    questions = [
        ExtractedQuestion(slide_number=12, question_index=1, question_id="dup-12"),
        ExtractedQuestion(slide_number=13, question_index=1, question_id="dup-12"),
    ]

    try:
        USMLEFormatter.format_batch(formatter, questions)
    except ValueError as exc:
        assert "Duplicate question_id values found" in str(exc)
        assert "dup-12" in str(exc)
    else:
        raise AssertionError("Expected duplicate question_id validation error")
