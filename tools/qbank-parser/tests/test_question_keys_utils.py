from __future__ import annotations

import main
from review.terminal_ui import ReviewResult
from utils.question_keys import question_key, question_key_from_review_result


def test_question_key_matches_main_wrapper():
    assert question_key(5, 1, "") == main.question_key(5, 1, "")
    assert question_key(5, 2, "") == main.question_key(5, 2, "")
    assert question_key(5, 2, "deck-5.2") == main.question_key(5, 2, "deck-5.2")


def test_question_key_from_review_result_uses_question_id_when_present():
    result = ReviewResult(
        question_id="deck-7.2",
        slide_number=7,
        question_index=2,
        status="confirmed",
    )
    assert question_key_from_review_result(result) == "deck-7.2"
