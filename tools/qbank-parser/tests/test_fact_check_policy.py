from __future__ import annotations

from domain.models import ExtractedQuestion
from formatting.fact_check import FactCheckService


def test_risk_classifier_uses_web_search_for_uncertain_items():
    question = ExtractedQuestion(
        slide_number=1,
        classification="needs_review",
        confidence=78,
        extraction_method="vision",
        question_stem="Stem",
        choices={"A": "One", "B": "Two", "C": "Three"},
        correct_answer="A",
        correct_answer_text="One",
        flags=["Answer inferred from comments"],
        comments=[{"content": "Could the answer instead be B?"}],
    )

    reasons = FactCheckService._risk_reasons(question)

    assert "needs_review" in reasons
    assert "low_confidence" in reasons
    assert "vision_ocr" in reasons
    assert "incomplete_choices" in reasons
    assert "comment_answer_discussion" in reasons


def test_clean_question_has_no_risk_reasons():
    question = ExtractedQuestion(
        slide_number=1,
        classification="accepted",
        confidence=96,
        extraction_method="text",
        question_stem="Stem",
        choices={"A": "One", "B": "Two", "C": "Three", "D": "Four"},
        correct_answer="A",
        correct_answer_text="One",
    )

    assert FactCheckService._risk_reasons(question) == []


def test_disputed_fact_check_does_not_remove_exportability():
    question = ExtractedQuestion(
        slide_number=1,
        classification="accepted",
        confidence=96,
        question_stem="Stem",
        choices={"A": "One", "B": "Two", "C": "Three", "D": "Four"},
        correct_answer="A",
        correct_answer_text="One",
    )
    question.fact_check = {"status": "disputed"}
    question.warnings.append("Fact-check disputed the keyed answer.")

    assert question.is_exportable_for_formatting() is True


def test_apply_disputed_fact_check_preserves_existing_classification():
    service = FactCheckService.__new__(FactCheckService)

    def fake_check_question(_question):
        return (
            {
                "status": "disputed",
                "note": "B is better.",
                "recommended_answer": "B",
                "recommended_answer_text": "Two",
                "model": "gpt-5.4",
                "sources": [],
            },
            [],
        )

    service.check_question = fake_check_question  # type: ignore[assignment]
    question = ExtractedQuestion(
        slide_number=1,
        classification="accepted",
        confidence=96,
        question_stem="Stem",
        choices={"A": "One", "B": "Two", "C": "Three", "D": "Four"},
        correct_answer="A",
        correct_answer_text="One",
    )

    checked = service.apply([question])[0]

    assert checked.classification == "accepted"
    assert checked.review_status == "approved"
    assert checked.proposed_correct_answer == "B"
    assert checked.is_exportable_for_formatting() is True
