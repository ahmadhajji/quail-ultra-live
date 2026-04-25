"""Shared question identity key helpers."""

from __future__ import annotations


def question_key(slide_number: int, question_index: int = 1, question_id: str | None = None) -> str:
    """Build a stable key for question identity across pipeline stages."""
    normalized_id = str(question_id or "").strip()
    if normalized_id:
        return normalized_id
    if question_index > 1:
        return f"{slide_number}.{question_index}"
    return str(slide_number)


def question_key_from_question(question) -> str:
    """Build stable key from an ExtractedQuestion-like object."""
    return question_key(
        slide_number=getattr(question, "slide_number", 0),
        question_index=getattr(question, "question_index", 1),
        question_id=getattr(question, "question_id", ""),
    )


def question_key_from_review_result(result) -> str:
    """Build stable key from a ReviewResult-like object."""
    return question_key(
        slide_number=getattr(result, "slide_number", 0),
        question_index=getattr(result, "question_index", 1),
        question_id=getattr(result, "question_id", ""),
    )

