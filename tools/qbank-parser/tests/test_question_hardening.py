from __future__ import annotations

from domain.models import ExtractedQuestion, USMLEQuestion
from formatting.choice_randomization import randomize_authored_choices
from utils.question_hardening import (
    audit_same_slide_conflicts,
    is_low_context_question,
    sanitize_choice_map,
    strip_bat_markers,
)


def test_strip_bat_markers_removes_repetition_tokens():
    assert strip_bat_markers("BAT25 BAT26* actual clue") == "actual clue"


def test_sanitize_choice_map_drops_bat_marker_choices():
    assert sanitize_choice_map({"A": "BAT25", "B": "Real answer", "C": "bat2*"}) == {
        "A": "",
        "B": "Real answer",
        "C": "",
    }


def test_is_low_context_question_uses_two_of_four_gate():
    question = ExtractedQuestion(
        slide_number=1,
        question_stem="DKA?",
        choices={"A": "Fluids", "B": "Insulin", "C": "", "D": "", "E": ""},
        correct_answer="A",
        source_of_answer="inferred",
        explanation="",
        comments=[],
    )
    assert is_low_context_question(question) is True


def test_same_slide_conflicts_add_related_ids_and_warnings():
    first = ExtractedQuestion(
        slide_number=7,
        question_index=1,
        question_id="7.1",
        question_stem="Best next step in management?",
        correct_answer="A",
        source_group_id="deck:7",
    )
    second = ExtractedQuestion(
        slide_number=7,
        question_index=2,
        question_id="7.2",
        question_stem="Best next step in management?",
        correct_answer="C",
        source_group_id="deck:7",
    )

    audit_same_slide_conflicts([first, second])

    assert first.related_question_ids == ["7.2"]
    assert second.related_question_ids == ["7.1"]
    assert "conflicting correct answer" in first.warnings[0].lower()


def test_choice_randomization_is_deterministic_and_remaps_correct_answer():
    question = USMLEQuestion(
        original_slide_number=1,
        question_id="deck-1",
        choices={"A": "One", "B": "Two", "C": "Three", "D": "Four"},
        correct_answer="B",
        incorrect_explanations={"A": "x", "C": "y", "D": "z"},
    )

    first = randomize_authored_choices(question)
    second = randomize_authored_choices(
        USMLEQuestion(
            original_slide_number=1,
            question_id="deck-1",
            choices={"A": "One", "B": "Two", "C": "Three", "D": "Four"},
            correct_answer="B",
            incorrect_explanations={"A": "x", "C": "y", "D": "z"},
        )
    )

    assert first.choices == second.choices
    assert first.correct_answer == second.correct_answer
    assert first.choice_presentation["shuffle_allowed"] is True
