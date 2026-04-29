"""Round-trip and content-hash tests for v2 pipeline domain models."""

from __future__ import annotations

import pytest

from domain.models import DetectedQuestion, RawSlide, RewrittenQuestion


# ---------------------------------------------------------------------------
# RawSlide
# ---------------------------------------------------------------------------


def _sample_raw_slide() -> RawSlide:
    return RawSlide(
        slide_number=3,
        deck_id="deck-abc",
        text_blocks=["A 5-year-old presents with cough.", "What is the most likely diagnosis?"],
        speaker_notes="Think viral URI",
        highlighted_texts=["viral upper respiratory infection"],
        potential_correct_answer="viral upper respiratory infection",
        image_paths=["/tmp/slide3_img1.png"],
        slide_screenshot_path="/tmp/slide3.png",
        comments=[{"author": "Dr. X", "content": "Why not bacterial?"}],
    )


def test_raw_slide_round_trip():
    original = _sample_raw_slide()
    restored = RawSlide.from_dict(original.to_dict())
    assert restored == original


def test_raw_slide_content_hash_includes_deck_and_media_content(tmp_path):
    image_a = tmp_path / "a.png"
    image_b = tmp_path / "b.png"
    image_a.write_bytes(b"image-a")
    image_b.write_bytes(b"image-b")
    a = _sample_raw_slide()
    b = _sample_raw_slide()
    a.image_paths = [str(image_a)]
    b.image_paths = [str(image_b)]
    assert a.content_hash() != b.content_hash()
    b.image_paths = [str(image_a)]
    b.deck_id = "other-deck"
    assert a.content_hash() != b.content_hash()


def test_raw_slide_content_hash_changes_on_text_edit():
    a = _sample_raw_slide()
    b = _sample_raw_slide()
    b.text_blocks = b.text_blocks + ["Extra block"]
    assert a.content_hash() != b.content_hash()


def test_raw_slide_content_hash_changes_on_speaker_notes_edit():
    a = _sample_raw_slide()
    b = _sample_raw_slide()
    b.speaker_notes = "Different note"
    assert a.content_hash() != b.content_hash()


def test_raw_slide_content_hash_includes_image_count():
    a = _sample_raw_slide()
    b = _sample_raw_slide()
    b.image_paths = b.image_paths + ["/tmp/extra.png"]
    # Image count changes -> hash should differ
    assert a.content_hash() != b.content_hash()


def test_raw_slide_defaults():
    slide = RawSlide(slide_number=1)
    assert slide.text_blocks == []
    assert slide.comments == []
    assert slide.deck_id == ""


# ---------------------------------------------------------------------------
# DetectedQuestion
# ---------------------------------------------------------------------------


def _sample_detected() -> DetectedQuestion:
    return DetectedQuestion(
        deck_id="deck-abc",
        slide_number=3,
        question_index=1,
        stem_text="A 5-year-old presents with cough.",
        choices={"A": "Viral URI", "B": "Bacterial pneumonia", "C": "Asthma", "D": "GERD"},
        correct_answer="A",
        explanation_hint="Viral URI is the most common cause",
        stem_image_paths=["/tmp/img1.png"],
        explanation_image_paths=[],
        source_slide_path="/tmp/slide3.png",
        speaker_notes="Think viral",
        comments=[{"content": "Discussion"}],
        highlighted_texts=["viral"],
        confidence=85,
        status="ok",
    )


def test_detected_question_round_trip():
    original = _sample_detected()
    restored = DetectedQuestion.from_dict(original.to_dict())
    assert restored == original


def test_detected_question_id_auto_assigned_single():
    q = DetectedQuestion(deck_id="d", slide_number=5, question_index=1)
    assert q.question_id == "5"


def test_detected_question_id_auto_assigned_multi():
    q = DetectedQuestion(deck_id="d", slide_number=5, question_index=2)
    assert q.question_id == "5.2"


def test_detected_question_id_explicit_preserved():
    q = DetectedQuestion(deck_id="d", slide_number=5, question_index=1, question_id="custom-id")
    assert q.question_id == "custom-id"


def test_detected_status_invalid_falls_back_to_ok():
    q = DetectedQuestion.from_dict({"slide_number": 1, "status": "garbage"})
    assert q.status == "ok"


def test_detected_content_hash_stable():
    a = _sample_detected()
    b = _sample_detected()
    assert a.content_hash() == b.content_hash()


def test_detected_content_hash_changes_on_choice_edit():
    a = _sample_detected()
    b = _sample_detected()
    b.choices = {**b.choices, "A": "Different choice text"}
    assert a.content_hash() != b.content_hash()


def test_detected_content_hash_excludes_quality_signals():
    a = _sample_detected()
    b = _sample_detected()
    b.confidence = 30
    b.detection_warnings = ["something"]
    b.status = "needs_review"
    # Quality signals don't change the rewrite input -> hash must match
    assert a.content_hash() == b.content_hash()


def test_detected_content_hash_changes_on_media_content(tmp_path):
    image_a = tmp_path / "a.png"
    image_b = tmp_path / "b.png"
    image_a.write_bytes(b"image-a")
    image_b.write_bytes(b"image-b")
    a = _sample_detected()
    b = _sample_detected()
    a.stem_image_paths = [str(image_a)]
    b.stem_image_paths = [str(image_b)]
    assert a.content_hash() != b.content_hash()


# ---------------------------------------------------------------------------
# RewrittenQuestion
# ---------------------------------------------------------------------------


def _sample_rewritten() -> RewrittenQuestion:
    return RewrittenQuestion(
        deck_id="deck-abc",
        slide_number=3,
        question_index=1,
        stem="A 5-year-old presents with...",
        choices={"A": "Viral URI", "B": "Bacterial pneumonia", "C": "Asthma", "D": "GERD"},
        correct_answer="A",
        correct_explanation="The vignette describes viral URI.",
        incorrect_explanations={
            "B": "Bacterial pneumonia would have higher fever.",
            "C": "Asthma would have wheezing.",
            "D": "GERD does not cause cough this way.",
        },
        educational_objective="Recognize the clinical features of viral URI in pediatrics.",
        rotation="Pediatrics",
        topic="Respiratory Infections",
        stem_image_paths=[],
        explanation_image_paths=[],
        source_slide_path="/tmp/slide3.png",
        rewrite_model="gpt-5.4",
    )


def test_rewritten_round_trip():
    original = _sample_rewritten()
    restored = RewrittenQuestion.from_dict(original.to_dict())
    assert restored == original


def test_rewritten_is_complete_happy_path():
    assert _sample_rewritten().is_complete() is True


def test_rewritten_is_complete_false_on_missing_edu_objective():
    q = _sample_rewritten()
    q.educational_objective = ""
    assert q.is_complete() is False


def test_rewritten_is_complete_false_on_missing_correct_explanation():
    q = _sample_rewritten()
    q.correct_explanation = "   "
    assert q.is_complete() is False


def test_rewritten_is_complete_false_on_missing_incorrect_explanation():
    q = _sample_rewritten()
    q.incorrect_explanations = {"B": "x", "C": "y"}  # missing D
    assert q.is_complete() is False


def test_rewritten_is_complete_false_on_correct_answer_not_in_choices():
    q = _sample_rewritten()
    q.correct_answer = "Z"
    assert q.is_complete() is False


def test_rewritten_is_complete_false_on_too_few_choices():
    q = _sample_rewritten()
    q.choices = {"A": "x", "B": "y"}
    q.correct_answer = "A"
    q.incorrect_explanations = {"B": "y"}
    assert q.is_complete() is False


def test_rewritten_is_complete_false_on_error():
    q = _sample_rewritten()
    q.error = "Stage 3 failed"
    assert q.is_complete() is False


def test_rewritten_is_complete_false_on_empty_choice_text():
    q = _sample_rewritten()
    q.choices = {**q.choices, "C": "   "}
    assert q.is_complete() is False


def test_rewritten_is_complete_false_on_missing_rotation():
    q = _sample_rewritten()
    q.rotation = ""
    assert q.is_complete() is False


def test_rewritten_question_id_auto_assigned():
    q = RewrittenQuestion(deck_id="d", slide_number=2, question_index=1)
    assert q.question_id == "2"


@pytest.mark.parametrize(
    "model_cls,sample_factory",
    [
        (RawSlide, _sample_raw_slide),
        (DetectedQuestion, _sample_detected),
        (RewrittenQuestion, _sample_rewritten),
    ],
)
def test_round_trip_via_dict_is_idempotent(model_cls, sample_factory):
    original = sample_factory()
    restored_once = model_cls.from_dict(original.to_dict())
    restored_twice = model_cls.from_dict(restored_once.to_dict())
    assert restored_once == restored_twice
