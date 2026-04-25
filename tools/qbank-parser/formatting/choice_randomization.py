"""Deterministic authored choice randomization."""

from __future__ import annotations

import hashlib
import random

from domain.models import USMLEQuestion


CHOICE_LETTERS = ["A", "B", "C", "D", "E"]


def randomize_authored_choices(question: USMLEQuestion) -> USMLEQuestion:
    """Deterministically reshuffle authored choices and remap answer keys."""
    if question.error:
        return question

    original_items = [(letter, text) for letter, text in question.choices.items() if str(text).strip()]
    if len(original_items) < 2:
        question.choice_text_by_letter = dict(question.choices)
        question.choice_presentation = {
            "shuffle_allowed": True,
            "display_order": list(question.choices.keys()),
        }
        return question

    seed = int(hashlib.sha256(question.question_id.encode("utf-8")).hexdigest()[:16], 16)
    rng = random.Random(seed)
    shuffled_items = original_items[:]
    rng.shuffle(shuffled_items)

    remapped_choices: dict[str, str] = {}
    remapped_incorrect: dict[str, str] = {}
    remapped_correct = question.correct_answer
    answer_remap: dict[str, str] = {}

    for index, (original_letter, text) in enumerate(shuffled_items):
        next_letter = CHOICE_LETTERS[index]
        remapped_choices[next_letter] = text
        answer_remap[original_letter] = next_letter
        if original_letter == question.correct_answer:
            remapped_correct = next_letter
        else:
            explanation = question.incorrect_explanations.get(original_letter, "")
            if explanation:
                remapped_incorrect[next_letter] = explanation

    question.choices = remapped_choices
    question.correct_answer = remapped_correct
    question.incorrect_explanations = remapped_incorrect
    question.choice_text_by_letter = dict(remapped_choices)
    question.choice_presentation = {
        "shuffle_allowed": True,
        "display_order": list(remapped_choices.keys()),
        "answer_remap": answer_remap,
    }
    return question
