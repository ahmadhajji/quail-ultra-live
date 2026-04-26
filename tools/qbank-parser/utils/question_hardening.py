"""Question hardening helpers for extraction, audit, and export."""

from __future__ import annotations

import hashlib
import re
from typing import Iterable

from domain.models import ExtractionClassification


BAT_MARKER_RE = re.compile(r"(?<!\w)(bat\d+[a-z*]*)(?!\w)", flags=re.IGNORECASE)
_NON_WORD_RE = re.compile(r"[^a-z0-9]+")


def strip_bat_markers(text: str) -> str:
    """Remove standalone BAT repetition markers from free text."""
    if not text:
        return ""
    cleaned = BAT_MARKER_RE.sub(" ", str(text))
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


def is_bat_marker(text: str) -> bool:
    """Return True when text is only a BAT repetition marker."""
    return bool(text and BAT_MARKER_RE.fullmatch(str(text).strip()))


def sanitize_choice_map(raw_choices: dict | None) -> dict[str, str]:
    """Drop BAT marker pseudo-choices and clean text values."""
    if not isinstance(raw_choices, dict):
        return {}

    cleaned: dict[str, str] = {}
    for letter, value in raw_choices.items():
        normalized_letter = str(letter).strip().upper()
        if normalized_letter not in {"A", "B", "C", "D", "E"}:
            continue
        cleaned_value = strip_bat_markers(str(value or ""))
        if cleaned_value and not is_bat_marker(cleaned_value):
            cleaned[normalized_letter] = cleaned_value
        else:
            cleaned[normalized_letter] = ""
    return cleaned


def non_empty_choice_letters(raw_choices: dict | None) -> list[str]:
    cleaned = sanitize_choice_map(raw_choices)
    return [letter for letter, value in cleaned.items() if value.strip()]


def duplicate_choice_texts(raw_choices: dict | None) -> list[str]:
    cleaned = sanitize_choice_map(raw_choices)
    seen: dict[str, str] = {}
    duplicates: list[str] = []
    for letter, value in cleaned.items():
        normalized = normalized_stem(value)
        if not normalized:
            continue
        if normalized in seen:
            duplicates.extend([seen[normalized], letter])
        else:
            seen[normalized] = letter
    return sorted(set(duplicates))


def build_extraction_validation(question, *, confidence_threshold: int = 70) -> dict[str, object]:
    """Build deterministic validation metadata for extracted questions."""
    choices = sanitize_choice_map(getattr(question, "choices", {}))
    non_empty_letters = [letter for letter, text in choices.items() if text.strip()]
    answer_letter = str(getattr(question, "correct_answer", "") or "").strip().upper()
    duplicate_letters = duplicate_choice_texts(choices)
    warnings = list(getattr(question, "warnings", []) or [])

    return {
        "has_stem": bool(normalized_stem(getattr(question, "question_stem", ""))),
        "non_empty_choice_letters": non_empty_letters,
        "choice_count": len(non_empty_letters),
        "correct_answer_letter": answer_letter,
        "correct_answer_in_choices": answer_letter in non_empty_letters,
        "duplicate_choice_letters": duplicate_letters,
        "low_confidence": int(getattr(question, "confidence", 0) or 0) < confidence_threshold,
        "vision_only": str(getattr(question, "extraction_method", "") or "") == "vision",
        "has_conflict_warning": any("conflicting correct answer" in str(item).lower() for item in warnings),
        "has_error": bool(str(getattr(question, "error", "") or "").strip()),
    }


def classify_extracted_question(
    question,
    *,
    model_suggested_valid: bool | None = None,
    confidence_threshold: int = 70,
) -> tuple[ExtractionClassification, list[str], dict[str, object]]:
    """Classify extraction result into accepted/needs_review/rejected/error."""
    validation = build_extraction_validation(question, confidence_threshold=confidence_threshold)
    reasons: list[str] = []

    if validation["has_error"]:
        reasons.append("Extraction error")
        return "error", reasons, validation

    if not validation["has_stem"]:
        reasons.append("Missing question stem")
        return "rejected", reasons, validation

    choice_count = int(validation["choice_count"])
    if choice_count < 2:
        reasons.append("Too few answer choices")
        return "rejected", reasons, validation

    if model_suggested_valid is False:
        reasons.append("Model did not accept this slide as a valid question")
        classification = "needs_review" if choice_count >= 3 else "rejected"
    else:
        classification = "accepted"

    if choice_count < 4:
        reasons.append("Question has fewer than four non-empty choices")
        classification = "needs_review"

    if not validation["correct_answer_letter"]:
        reasons.append("Missing correct answer")
        classification = "needs_review"
    elif not validation["correct_answer_in_choices"]:
        reasons.append("Correct answer is not present in answer choices")
        classification = "needs_review"

    duplicate_letters = list(validation["duplicate_choice_letters"])
    if duplicate_letters:
        reasons.append(f"Duplicate answer choices detected ({', '.join(duplicate_letters)})")
        classification = "needs_review"

    if bool(validation["low_confidence"]):
        reasons.append("Low extraction confidence")
        classification = "needs_review"

    if bool(validation["vision_only"]):
        reasons.append("Requires visual rescue/vision extraction")
        classification = "needs_review"

    if bool(validation["has_conflict_warning"]):
        reasons.append("Conflicting same-slide duplicate detected")
        classification = "needs_review"

    fact_check = getattr(question, "fact_check", {}) or {}
    if isinstance(fact_check, dict):
        status = str(fact_check.get("status", "") or "").strip().lower()
        if status == "disputed":
            reasons.append("Fact-check disputed the keyed answer")
            classification = "needs_review"
        elif status == "unresolved":
            reasons.append("Fact-check could not verify the keyed answer")
            classification = "needs_review"

    return classification, reasons, validation


def normalized_stem(text: str) -> str:
    """Normalize a question stem for near-duplicate comparison."""
    base = strip_bat_markers(text).lower()
    compact = _NON_WORD_RE.sub(" ", base)
    return re.sub(r"\s+", " ", compact).strip()


def compute_dedupe_fingerprint(source_group_id: str, stem: str) -> str:
    """Build a stable fingerprint for near-duplicate detection."""
    normalized = normalized_stem(stem)
    digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:12]
    return f"{source_group_id}:{digest}" if source_group_id else digest


def is_low_context_question(question) -> bool:
    """Gate auto-rekey to fragmentary / low-evidence question forms."""
    checks = 0

    stem = normalized_stem(getattr(question, "question_stem", ""))
    if len(stem.replace(" ", "")) < 120:
        checks += 1

    choices = sanitize_choice_map(getattr(question, "choices", {}))
    non_empty_choices = sum(1 for value in choices.values() if value.strip())
    if non_empty_choices < 4:
        checks += 1

    source_of_answer = str(getattr(question, "source_of_answer", "") or "").strip().lower()
    if source_of_answer in {"", "inferred"}:
        checks += 1

    explanation = strip_bat_markers(str(getattr(question, "explanation", "") or ""))
    comments = getattr(question, "comments", []) or []
    comment_text = " ".join(
        strip_bat_markers(str(item.get("content", "")))
        for item in comments
        if isinstance(item, dict)
    ).strip()
    if not explanation and not comment_text:
        checks += 1

    return checks >= 2


def audit_same_slide_conflicts(questions: Iterable) -> None:
    """Flag same-slide near-duplicates with conflicting answers."""
    groups: dict[str, list] = {}
    for question in questions:
        group_id = str(getattr(question, "source_group_id", "") or "").strip()
        if not group_id:
            continue
        groups.setdefault(group_id, []).append(question)

    for group_items in groups.values():
        for index, left in enumerate(group_items):
            left_norm = normalized_stem(getattr(left, "question_stem", ""))
            if not left_norm:
                continue
            for right in group_items[index + 1 :]:
                right_norm = normalized_stem(getattr(right, "question_stem", ""))
                if not right_norm or left_norm != right_norm:
                    continue
                left_id = str(getattr(left, "question_id", "") or "").strip()
                right_id = str(getattr(right, "question_id", "") or "").strip()
                if left_id and right_id:
                    if right_id not in getattr(left, "related_question_ids", []):
                        left.related_question_ids.append(right_id)
                    if left_id not in getattr(right, "related_question_ids", []):
                        right.related_question_ids.append(left_id)
                if getattr(left, "correct_answer", "") != getattr(right, "correct_answer", ""):
                    warning = "Same-slide near-duplicate has a conflicting correct answer."
                    if warning not in getattr(left, "warnings", []):
                        left.warnings.append(warning)
                    if warning not in getattr(right, "warnings", []):
                        right.warnings.append(warning)
                    if hasattr(left, "classification") and getattr(left, "classification", "") == "accepted":
                        left.classification = "needs_review"
                    if hasattr(right, "classification") and getattr(right, "classification", "") == "accepted":
                        right.classification = "needs_review"
