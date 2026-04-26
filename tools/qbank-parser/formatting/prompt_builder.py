"""Prompt construction for USMLE formatting."""

from __future__ import annotations

from ai.prompts import USMLE_FORMATTER_PROMPT
from ai.rotation_prompts import build_rotation_formatter_prompt, normalize_rotation_name
from domain.models import ExtractedQuestion
from utils.question_hardening import sanitize_choice_map, strip_bat_markers


def build_prompt(question: ExtractedQuestion) -> tuple[str, str]:
    """Build formatter prompt and return canonical rotation used."""
    cleaned_choices = sanitize_choice_map(question.choices)
    choices_text = "\n".join([f"{letter}: {text}" for letter, text in cleaned_choices.items() if text])

    raw_rotation = getattr(question, "rotation", "") or ""
    try:
        canonical_rotation = normalize_rotation_name(raw_rotation) if raw_rotation else "Internal Medicine"
    except ValueError:
        canonical_rotation = "Internal Medicine"

    try:
        prompt = build_rotation_formatter_prompt(
            rotation=canonical_rotation,
            question_stem=strip_bat_markers(question.question_stem),
            choices=choices_text,
            correct_answer=f"{question.correct_answer}. {strip_bat_markers(question.correct_answer_text)}",
            explanation=strip_bat_markers(question.explanation) or "None provided",
            slide_number=question.slide_number,
            has_images="Yes" if question.images else "No",
        )
    except Exception:
        prompt = USMLE_FORMATTER_PROMPT.format(
            question_stem=strip_bat_markers(question.question_stem),
            choices=choices_text,
            correct_answer=f"{question.correct_answer}. {strip_bat_markers(question.correct_answer_text)}",
            explanation=strip_bat_markers(question.explanation) or "None provided",
            slide_number=question.slide_number,
            has_images="Yes" if question.images else "No",
        )

    return prompt, canonical_rotation
