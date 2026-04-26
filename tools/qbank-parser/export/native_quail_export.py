"""Native Quail Ultra qbank exporter.

This exporter maps existing USMLE-formatted question JSON to the structured
Quail Ultra v1 contract. It does not call AI.
"""

from __future__ import annotations

import hashlib
import json
import random
import re
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from export.native_contract import NATIVE_QBANK_MANIFEST, schema_checksum, validate_native_pack_directory
from export.native_pack_state import PACK_STATE_FILE, NativePackState, source_key_for_question
from export.quail_export import resolve_image_path
from utils.question_hardening import strip_bat_markers, sanitize_choice_map


CHOICE_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"]


def _default_logger(message: str) -> None:
    print(message)


@dataclass
class NativeQuailExportSummary:
    source_json: Path
    output_dir: Path
    mode: str
    questions_written: int
    questions_added: int
    questions_updated: int
    questions_skipped: int
    total_questions: int
    media_files_copied: int
    validation_errors: list[str]
    qa_report_json: Path | None = None
    qa_report_markdown: Path | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "source_json": str(self.source_json),
            "output_dir": str(self.output_dir),
            "mode": self.mode,
            "questions_written": self.questions_written,
            "questions_added": self.questions_added,
            "questions_updated": self.questions_updated,
            "questions_skipped": self.questions_skipped,
            "total_questions": self.total_questions,
            "media_files_copied": self.media_files_copied,
            "validation_errors": self.validation_errors,
            "qa_report_json": str(self.qa_report_json) if self.qa_report_json else "",
            "qa_report_markdown": str(self.qa_report_markdown) if self.qa_report_markdown else "",
        }


def _slug(value: str, fallback: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._:-]+", ".", str(value or "").strip())
    cleaned = cleaned.strip(".:-_")
    if not cleaned:
        cleaned = fallback
    if not re.match(r"^[A-Za-z0-9]", cleaned):
        cleaned = f"q{cleaned}"
    return cleaned


def _content_blocks(text: str, fallback: str) -> list[dict[str, Any]]:
    normalized = strip_bat_markers(str(text or "")).replace("\r\n", "\n").strip()
    if not normalized:
        normalized = fallback
    paragraphs = [part.strip() for part in re.split(r"\n\s*\n", normalized) if part.strip()]
    return [{"type": "paragraph", "text": paragraph} for paragraph in paragraphs]


def _blocks_text(blocks: list[dict[str, Any]]) -> str:
    parts: list[str] = []
    for block in blocks:
        if block.get("type") == "paragraph":
            parts.append(str(block.get("text", "")))
        elif block.get("type") == "list":
            parts.extend(str(item) for item in block.get("items", []))
        elif block.get("type") == "table":
            for row in block.get("rows", []):
                parts.append(" ".join(str(cell) for cell in row))
    return " ".join(parts).strip()


def _hash_json(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()


def _randomized_choice_payload(
    *,
    qid: str,
    choices: dict[str, Any],
    correct_answer: str,
    incorrect_explanations: dict[str, Any],
) -> tuple[dict[str, str], str, dict[str, str], list[str]]:
    original_items = [(str(letter), str(text)) for letter, text in choices.items() if str(text).strip()]
    if len(original_items) < 2 or len(original_items) > len(CHOICE_LETTERS):
        normalized = {letter: text for letter, text in original_items}
        return normalized, correct_answer, {
            str(letter): str(explanation)
            for letter, explanation in incorrect_explanations.items()
            if str(letter) in normalized and str(explanation).strip()
        }, list(normalized.keys())

    seed = int(hashlib.sha256(qid.encode("utf-8")).hexdigest()[:16], 16)
    shuffled = original_items[:]
    random.Random(seed).shuffle(shuffled)

    remapped_choices: dict[str, str] = {}
    remapped_incorrect: dict[str, str] = {}
    remapped_correct = correct_answer
    for index, (original_letter, text) in enumerate(shuffled):
        next_letter = CHOICE_LETTERS[index]
        remapped_choices[next_letter] = text
        if original_letter == correct_answer:
            remapped_correct = next_letter
        elif str(incorrect_explanations.get(original_letter, "")).strip():
            remapped_incorrect[next_letter] = str(incorrect_explanations[original_letter])

    return remapped_choices, remapped_correct, remapped_incorrect, list(remapped_choices.keys())


def _source_hash(question: dict[str, Any], pack_id: str) -> str:
    return _hash_json(
        {
            "source_key": source_key_for_question(question, pack_id),
            "stem": question.get("question_stem", ""),
            "question": question.get("question", ""),
            "choices": question.get("choices", {}),
            "correct": question.get("correct_answer", ""),
            "explanation": question.get("correct_answer_explanation", question.get("explanation", "")),
            "images": question.get("images", []),
            "explanation_images": question.get("explanation_images", []),
            "source_slide": question.get("source_slide_path", ""),
        }
    )


def _clean_text(value: Any) -> str:
    return strip_bat_markers(str(value or ""))


def _clean_comments(comments: Any) -> list[dict[str, Any]]:
    if not isinstance(comments, list):
        return []
    cleaned: list[dict[str, Any]] = []
    for item in comments:
        if not isinstance(item, dict):
            continue
        next_item = dict(item)
        if "content" in next_item:
            next_item["content"] = _clean_text(next_item.get("content", ""))
        cleaned.append(next_item)
    return cleaned


def _copy_media(
    *,
    source_value: str,
    media_id: str,
    role: str,
    output_dir: Path,
    images_dir: Path,
    source_json_dir: Path,
    media_subdir: str = "media",
) -> tuple[dict[str, Any], bool]:
    resolved = resolve_image_path(source_value, images_dir, source_json_dir)
    if resolved is None:
        raise FileNotFoundError(f"Media not found: {source_value}")

    digest = hashlib.sha256(resolved.read_bytes()).hexdigest()
    suffix = resolved.suffix.lower() or ".png"
    if media_subdir == "source-slides":
        relative_path = Path(media_subdir) / f"{media_id}{suffix}"
    else:
        relative_path = Path(media_subdir) / f"{digest}{suffix}"
    target = output_dir / relative_path
    target.parent.mkdir(parents=True, exist_ok=True)
    copied = False
    if not target.exists():
        shutil.copy2(resolved, target)
        copied = True
    return (
        {
            "id": media_id,
            "path": relative_path.as_posix(),
            "mimeType": "image/svg+xml" if suffix == ".svg" else "image/png",
            "role": role,
            "sha256": digest,
        },
        copied,
    )


def _is_true_error_or_non_question(question: dict[str, Any]) -> bool:
    classification = str(question.get("extraction_classification", question.get("classification", "")) or "").strip()
    if classification == "error":
        return True
    if classification == "rejected":
        return True
    if str(question.get("error", "") or "").strip():
        return True
    return False


def _quality_warnings(question: dict[str, Any]) -> list[str]:
    warnings = [str(item) for item in question.get("warnings", []) if str(item).strip()] if isinstance(question.get("warnings"), list) else []
    review_status = str(question.get("review_status", "") or "").strip()
    classification = str(question.get("extraction_classification", question.get("classification", "")) or "").strip()
    fact_check = question.get("fact_check", {})
    fact_check_status = str(fact_check.get("status", "") or "").strip() if isinstance(fact_check, dict) else ""
    if classification == "needs_review":
        warnings.append("AI adjudication/review warning: extracted item was marked needs_review.")
    if review_status and review_status not in {"approved", "edited", "rekeyed"}:
        warnings.append(f"Review status is {review_status}; included by native all-non-error policy.")
    if fact_check_status in {"disputed", "unresolved"}:
        warnings.append(f"Fact-check status is {fact_check_status}; included with warning.")
    if not str(question.get("educational_objective", "") or "").strip():
        warnings.append("Missing educational objective.")
    if not str(question.get("correct_answer_explanation", question.get("explanation", "")) or "").strip():
        warnings.append("Missing detailed explanation.")
    return sorted(set(warnings))


def _question_to_native(
    *,
    question: dict[str, Any],
    qid: str,
    pack_id: str,
    output_dir: Path,
    images_dir: Path,
    source_json_dir: Path,
) -> tuple[dict[str, Any], list[dict[str, Any]], int]:
    choices = sanitize_choice_map(question.get("choices", {}))
    if not isinstance(choices, dict) or len(choices) < 2:
        raise ValueError(f"Question {qid} must have at least two choices.")
    correct_answer = str(question.get("correct_answer", "") or "")
    if correct_answer not in choices or not str(choices.get(correct_answer, "")).strip():
        raise ValueError(f"Question {qid} correct_answer {correct_answer!r} is not present in choices.")

    raw_incorrect_explanations = question.get("incorrect_explanations", {})
    incorrect_explanations = {
        str(letter): _clean_text(explanation)
        for letter, explanation in raw_incorrect_explanations.items()
    } if isinstance(raw_incorrect_explanations, dict) else {}
    choice_presentation = question.get("choice_presentation", {})
    raw_display_order = choice_presentation.get("display_order", []) if isinstance(choice_presentation, dict) else []
    display_order = [str(item) for item in raw_display_order if str(item) in choices]
    if display_order:
        choices = {str(letter): _clean_text(choices[letter]) for letter in choices}
        incorrect_explanations = {
            str(letter): str(explanation)
            for letter, explanation in incorrect_explanations.items()
            if str(letter) in choices and str(explanation).strip()
        }
    else:
        choices, correct_answer, incorrect_explanations, display_order = _randomized_choice_payload(
            qid=qid,
            choices=choices,
            correct_answer=correct_answer,
            incorrect_explanations=incorrect_explanations,
        )

    original_order = {letter: index + 1 for index, letter in enumerate(sorted(str(letter) for letter in choices))}
    native_choices = [
        {
            "id": letter,
            "label": letter,
            "displayOrder": index + 1,
            "originalOrder": original_order.get(letter, index + 1),
            "text": _content_blocks(str(choices[letter]), f"Choice {letter}"),
            "textHash": hashlib.sha256(str(choices[letter]).encode("utf-8")).hexdigest(),
        }
        for index, letter in enumerate(display_order)
    ]

    question_media: list[dict[str, Any]] = []
    copied_count = 0
    stem_blocks = _content_blocks(_clean_text(question.get("question_stem", "")), "No stem provided.")
    question_text = _clean_text(question.get("question", "")).strip()
    if question_text and question_text != _clean_text(question.get("question_stem", "")).strip():
        stem_blocks.extend(_content_blocks(question_text, question_text))

    for image_index, image_value in enumerate(question.get("images", []) if isinstance(question.get("images"), list) else [], start=1):
        media_id = f"{qid}.stem.{image_index}"
        media, copied = _copy_media(
            source_value=str(image_value),
            media_id=media_id,
            role="stem",
            output_dir=output_dir,
            images_dir=images_dir,
            source_json_dir=source_json_dir,
        )
        question_media.append(media)
        copied_count += int(copied)
        stem_blocks.append({"type": "media", "mediaId": media_id})

    correct_blocks = _content_blocks(
        _clean_text(question.get("correct_answer_explanation", "") or question.get("explanation", "")),
        "No explanation provided.",
    )
    for image_index, image_value in enumerate(
        question.get("explanation_images", []) if isinstance(question.get("explanation_images"), list) else [],
        start=1,
    ):
        media_id = f"{qid}.explanation.{image_index}"
        media, copied = _copy_media(
            source_value=str(image_value),
            media_id=media_id,
            role="explanation",
            output_dir=output_dir,
            images_dir=images_dir,
            source_json_dir=source_json_dir,
        )
        question_media.append(media)
        copied_count += int(copied)
        correct_blocks.append({"type": "media", "mediaId": media_id})

    deck_id = str(question.get("deck_id", "") or pack_id)
    source_slide_path = str(question.get("source_slide_path", "") or "").strip()
    source_slide_media_id = ""
    if source_slide_path:
        slide_number = int(question.get("original_slide_number", question.get("slide_number", 0)) or 0)
        source_slide_media_id = f"source.{_slug(deck_id, pack_id)}.{slide_number:03d}"
        media, copied = _copy_media(
            source_value=source_slide_path,
            media_id=source_slide_media_id,
            role="source_slide",
            output_dir=output_dir,
            images_dir=source_json_dir,
            source_json_dir=source_json_dir,
            media_subdir="source-slides",
        )
        question_media.append(media)
        copied_count += int(copied)

    tags = question.get("tags", {}) if isinstance(question.get("tags", {}), dict) else {}
    native_tags = {
        "rotation": str(tags.get("rotation", question.get("rotation", "Untagged")) or "Untagged"),
        "subject": str(tags.get("subject", tags.get("discipline", "")) or ""),
        "system": str(tags.get("system", "") or ""),
        "topic": str(tags.get("topic", tags.get("system", tags.get("discipline", "Untagged"))) or "Untagged"),
        "custom": [str(item) for item in tags.get("custom", [])] if isinstance(tags.get("custom"), list) else [],
    }

    fact_check = question.get("fact_check", {}) if isinstance(question.get("fact_check", {}), dict) else {}
    confidence = question.get("confidence", question.get("parser_confidence", 100))
    parser_confidence = float(confidence) / 100 if isinstance(confidence, (int, float)) and confidence > 1 else float(confidence or 1)
    parser_confidence = max(0.0, min(1.0, parser_confidence))

    native_incorrect = {
        str(letter): _content_blocks(str(explanation), f"Choice {letter} explanation.")
        for letter, explanation in incorrect_explanations.items()
        if str(explanation).strip()
    }

    source_slide_part = {"sourceSlideMediaId": source_slide_media_id} if source_slide_media_id else {}
    quality_warnings = _quality_warnings(question)
    native_question = {
        "id": qid,
        "schemaVersion": 1,
        "status": "ready",
        "source": {
            "documentId": deck_id,
            "documentTitle": str(question.get("document_title", "") or ""),
            "slideNumber": int(question.get("original_slide_number", question.get("slide_number", 1)) or 1),
            "questionIndex": int(question.get("original_question_index", question.get("question_index", 1)) or 1),
            "variantLabel": str(question.get("variant_label", "") or ""),
            "sourceGroupId": str(question.get("source_group_id", "") or ""),
            **source_slide_part,
            "comments": _clean_comments(question.get("comments", [])),
        },
        "tags": native_tags,
        "stem": {"blocks": stem_blocks},
        "choices": native_choices,
        "answerKey": {
            "correctChoiceId": correct_answer,
            "source": str(question.get("source_of_answer", "formatted answer key") or "formatted answer key"),
            "confidence": parser_confidence,
            "reviewStatus": str(question.get("review_status", "approved") or "approved"),
        },
        "explanation": {
            "correct": correct_blocks,
            "incorrect": native_incorrect,
            "educationalObjective": _content_blocks(
                _clean_text(question.get("educational_objective", "")),
                "No educational objective provided.",
            ),
            "references": [str(item) for item in question.get("grounding_sources", [])]
            if isinstance(question.get("grounding_sources"), list)
            else [],
        },
        "media": question_media,
        "quality": {
            "parserConfidence": parser_confidence,
            "validationStatus": "passed",
            "reviewStatus": str(question.get("review_status", "approved") or "approved"),
            "warnings": quality_warnings,
            "errors": [],
            "factCheck": {
                "status": str(fact_check.get("status", "") or ""),
                "note": str(fact_check.get("note", "") or ""),
                "sources": fact_check.get("sources", []) if isinstance(fact_check.get("sources", []), list) else [],
                "model": str(fact_check.get("model", "") or ""),
            },
        },
        "ai": {
            "extractionModel": str(question.get("extraction_model", "") or ""),
            "formatterModel": str(question.get("formatter_model", "") or ""),
            "factCheckModel": str(fact_check.get("model", "") or ""),
            "promptVersion": str(question.get("prompt_version", "") or ""),
            "schemaVersion": "1",
            "inputHash": str(question.get("input_hash", "") or ""),
            "outputHash": hashlib.sha256(str(question.get("raw_response", "")).encode("utf-8")).hexdigest(),
            "cacheKeys": [],
            "cost": {"inputTokens": 0, "outputTokens": 0, "estimatedUsd": 0},
        },
        "dedupe": {
            "fingerprint": str(question.get("dedupe_fingerprint", "") or ""),
            "duplicateGroupId": str(question.get("source_group_id", "") or ""),
            "relatedQuestionIds": question.get("related_question_ids", [])
            if isinstance(question.get("related_question_ids"), list)
            else [],
            "conflictStatus": "none",
        },
        "integrity": {
            "sourceHash": _source_hash(question, pack_id),
            "contentHash": _hash_json(
                {
                    "stem": _blocks_text(stem_blocks),
                    "choices": choices,
                    "correct": correct_answer,
                    "explanation": _blocks_text(correct_blocks),
                }
            ),
            "mediaHashes": {media["id"]: media.get("sha256", "") for media in question_media},
        },
    }
    return native_question, question_media, copied_count


def _write_native_sample_report(
    *,
    target_dir: Path,
    source_questions: list[dict[str, Any]],
    native_questions: dict[str, dict[str, Any]],
    excluded: list[dict[str, Any]],
    validation_errors: list[str],
) -> tuple[Path, Path]:
    validation_dir = target_dir / "validation"
    validation_dir.mkdir(parents=True, exist_ok=True)

    answer_distribution: dict[str, int] = {}
    warning_questions: list[dict[str, Any]] = []
    missing_objectives: list[str] = []
    missing_explanations: list[str] = []
    source_slide_missing: list[str] = []
    for qid, question in sorted(native_questions.items()):
        correct = str(question.get("answerKey", {}).get("correctChoiceId", "") or "")
        if correct:
            answer_distribution[correct] = answer_distribution.get(correct, 0) + 1
        warnings = question.get("quality", {}).get("warnings", [])
        if warnings:
            warning_questions.append({"id": qid, "warnings": warnings})
        objective = question.get("explanation", {}).get("educationalObjective", [])
        if _blocks_text(objective) == "No educational objective provided.":
            missing_objectives.append(qid)
        correct_blocks = question.get("explanation", {}).get("correct", [])
        if _blocks_text(correct_blocks) == "No explanation provided.":
            missing_explanations.append(qid)
        if not question.get("source", {}).get("sourceSlideMediaId"):
            source_slide_missing.append(qid)

    source_bat_count = 0
    for question in source_questions:
        packed = json.dumps(question, ensure_ascii=False)
        if strip_bat_markers(packed) != packed:
            source_bat_count += 1

    report = {
        "command": " ".join(sys.argv),
        "includedQuestionCount": len(native_questions),
        "sourceQuestionCount": len(source_questions),
        "excludedQuestionCount": len(excluded),
        "includedQuestions": sorted(native_questions),
        "warningQuestions": warning_questions,
        "excluded": excluded,
        "answerDistribution": dict(sorted(answer_distribution.items())),
        "batMarkerFindings": {
            "sourceRecordsWithBatMarkers": source_bat_count,
            "finalOutputPolicy": "BAT markers are stripped from native user-facing fields.",
        },
        "missingEducationalObjectives": missing_objectives,
        "missingExplanations": missing_explanations,
        "sourceSlideMissing": source_slide_missing,
        "costSummary": {
            "status": "unknown",
            "note": "Native export does not call AI. Use extraction/formatting stats for API cost.",
        },
        "schemaValidation": {
            "ok": not validation_errors,
            "errors": validation_errors,
        },
    }

    json_path = validation_dir / "native_sample_report.json"
    markdown_path = validation_dir / "native_sample_report.md"
    json_path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")

    lines = [
        "# Native Sample Run Report",
        "",
        f"- Included questions: {report['includedQuestionCount']}",
        f"- Source questions considered: {report['sourceQuestionCount']}",
        f"- Excluded records: {report['excludedQuestionCount']}",
        f"- Schema validation: {'passed' if report['schemaValidation']['ok'] else 'failed'}",
        f"- Answer distribution: {report['answerDistribution']}",
        f"- Warning questions: {len(warning_questions)}",
        f"- Missing educational objectives: {len(missing_objectives)}",
        f"- Missing explanations: {len(missing_explanations)}",
        f"- Source records with BAT markers: {source_bat_count}",
        "",
        "## Excluded",
    ]
    if excluded:
        lines.extend(f"- {item['id']}: {item['reason']}" for item in excluded)
    else:
        lines.append("- None")
    lines.extend(["", "## Warnings"])
    if warning_questions:
        for item in warning_questions:
            lines.append(f"- {item['id']}: {'; '.join(item['warnings'])}")
    else:
        lines.append("- None")
    markdown_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return json_path, markdown_path


def export_native_quail_qbank(
    source_json: str | Path,
    output_dir: str | Path,
    *,
    pack_id: str,
    title: str | None = None,
    images_dir: str | Path | None = None,
    append: bool = False,
    pack_state_path: str | Path | None = None,
    slide_range: tuple[int, int] | None = None,
    max_questions: int | None = None,
    only_new: bool = False,
    only_failed: bool = False,
    reprocess_question: str | None = None,
    logger: Callable[[str], None] | None = None,
) -> NativeQuailExportSummary:
    logger_fn = logger or _default_logger
    source_path = Path(source_json).resolve()
    target_dir = Path(output_dir).resolve()
    if not source_path.exists():
        raise FileNotFoundError(f"Source JSON file not found: {source_path}")
    source_json_dir = source_path.parent
    images_path = Path(images_dir).resolve() if images_dir else source_json_dir / "extracted_images"
    if not images_path.exists():
        images_path = source_json_dir

    data = json.loads(source_path.read_text(encoding="utf-8"))
    questions = data.get("questions", [])
    if not isinstance(questions, list):
        raise ValueError("Input JSON must contain a top-level 'questions' array.")
    questions = [question for question in questions if isinstance(question, dict)]

    state_path = Path(pack_state_path).resolve() if pack_state_path else target_dir / PACK_STATE_FILE
    pack_state = NativePackState.load(state_path, pack_id=_slug(pack_id, "qbank")) if append else NativePackState(pack_id=_slug(pack_id, "qbank"))

    if slide_range:
        start, end = slide_range
        questions = [
            question for question in questions
            if start <= int(question.get("original_slide_number", question.get("slide_number", 0)) or 0) <= end
        ]
    if reprocess_question:
        questions = [
            question for question in questions
            if pack_state.question_id_for(source_key=source_key_for_question(question, pack_id), question=question) == reprocess_question
            or str(question.get("question_id", "")) == reprocess_question
        ]
    if only_new:
        questions = [
            question for question in questions
            if source_key_for_question(question, pack_id) not in pack_state.questions
        ]
    if only_failed:
        questions = [
            question for question in questions
            if pack_state.questions.get(source_key_for_question(question, pack_id), {}).get("status") in {"failed", "blocked"}
        ]
    if max_questions is not None:
        questions = questions[:max(0, max_questions)]

    source_questions = questions[:]
    excluded: list[dict[str, Any]] = []
    publishable_questions: list[dict[str, Any]] = []
    for question in questions:
        if _is_true_error_or_non_question(question):
            excluded.append(
                {
                    "id": str(question.get("question_id", question.get("slide_number", "unknown")) or "unknown"),
                    "slide": int(question.get("original_slide_number", question.get("slide_number", 0)) or 0),
                    "reason": str(question.get("error", "") or question.get("extraction_classification", question.get("classification", "excluded"))),
                }
            )
        else:
            publishable_questions.append(question)
    questions = publishable_questions

    if target_dir.exists() and not append:
        shutil.rmtree(target_dir)
    target_dir.mkdir(parents=True, exist_ok=True)
    (target_dir / "questions").mkdir(parents=True, exist_ok=True)
    (target_dir / "media").mkdir(parents=True, exist_ok=True)

    existing_manifest: dict[str, Any] | None = None
    existing_questions: dict[str, dict[str, Any]] = {}
    existing_media: dict[str, dict[str, Any]] = {}
    manifest_path = target_dir / NATIVE_QBANK_MANIFEST
    if append and manifest_path.exists():
        existing_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        for entry in existing_manifest.get("questionIndex", []):
            path_value = target_dir / str(entry.get("path", ""))
            if path_value.exists():
                existing_questions[str(entry.get("id"))] = json.loads(path_value.read_text(encoding="utf-8"))
        existing_media = {
            str(media.get("id")): media for media in existing_manifest.get("mediaIndex", [])
        }

    native_questions = existing_questions.copy()
    media_by_id = existing_media.copy()
    fingerprint_answers: dict[str, tuple[str, str]] = {}
    for existing_qid, existing_question in native_questions.items():
        fingerprint = str(existing_question.get("dedupe", {}).get("fingerprint", "") or "")
        correct = str(existing_question.get("answerKey", {}).get("correctChoiceId", "") or "")
        if fingerprint and correct:
            fingerprint_answers[fingerprint] = (existing_qid, correct)

    copied_count = 0
    added_count = 0
    updated_count = 0
    skipped_count = 0
    written_count = 0
    change_summary_by_qid: dict[str, str] = {}
    for question in questions:
        source_key = source_key_for_question(question, pack_id)
        qid = pack_state.question_id_for(source_key=source_key, question=question)
        try:
            native_question, media_items, copied = _question_to_native(
                question=question,
                qid=qid,
                pack_id=pack_id,
                output_dir=target_dir,
                images_dir=images_path,
                source_json_dir=source_json_dir,
            )
        except Exception as exc:
            excluded.append(
                {
                    "id": qid,
                    "slide": int(question.get("original_slide_number", question.get("slide_number", 0)) or 0),
                    "reason": str(exc),
                }
            )
            pack_state.record_decision(
                source_key=source_key,
                question_id=qid,
                source_hash=_source_hash(question, pack_id),
                content_hash="",
                status="failed",
                action="excluded",
                dedupe_fingerprint=str(question.get("dedupe_fingerprint", "") or ""),
            )
            continue
        content_hash = native_question["integrity"]["contentHash"]
        source_hash = native_question["integrity"]["sourceHash"]
        existing_state = pack_state.questions.get(source_key, {})
        existing_question = native_questions.get(qid)
        dedupe_fingerprint = str(native_question.get("dedupe", {}).get("fingerprint", "") or "")
        correct_answer = str(native_question.get("answerKey", {}).get("correctChoiceId", "") or "")
        if dedupe_fingerprint and dedupe_fingerprint in fingerprint_answers:
            other_qid, other_correct = fingerprint_answers[dedupe_fingerprint]
            if other_qid != qid and other_correct != correct_answer:
                reason = (
                    f"Duplicate fingerprint {dedupe_fingerprint!r} has conflicting answers "
                    f"{other_qid}={other_correct} and {qid}={correct_answer}."
                )
                pack_state.record_blocked(source_key=source_key, question_id=qid, reason=reason)
                pack_state.save(state_path)
                raise ValueError(reason)

        if append and existing_question and existing_state.get("lastContentHash") == content_hash:
            skipped_count += 1
            pack_state.record_decision(
                source_key=source_key,
                question_id=qid,
                source_hash=source_hash,
                content_hash=content_hash,
                status="ready",
                action="skipped",
                dedupe_fingerprint=dedupe_fingerprint,
            )
            change_summary_by_qid[qid] = "skipped"
            continue

        action = "updated" if existing_question else "added"
        native_questions[qid] = native_question
        for media in media_items:
            media_by_id[media["id"]] = media
        copied_count += copied
        written_count += 1
        if action == "updated":
            updated_count += 1
        else:
            added_count += 1
        pack_state.record_decision(
            source_key=source_key,
            question_id=qid,
            source_hash=source_hash,
            content_hash=content_hash,
            status="ready",
            action=action,
            dedupe_fingerprint=dedupe_fingerprint,
        )
        change_summary_by_qid[qid] = action
        if dedupe_fingerprint and correct_answer:
            fingerprint_answers[dedupe_fingerprint] = (qid, correct_answer)

    question_index = []
    tag_index: dict[str, set[str]] = {"rotation": set(), "subject": set(), "system": set(), "topic": set()}
    for qid in sorted(native_questions):
        question = native_questions[qid]
        question_path = Path("questions") / f"{qid}.json"
        (target_dir / question_path).write_text(json.dumps(question, indent=2, ensure_ascii=False), encoding="utf-8")
        tags = question["tags"]
        for key in tag_index:
            value = str(tags.get(key, "") or "")
            if value:
                tag_index[key].add(value)
        question_index.append(
            {
                "id": qid,
                "path": question_path.as_posix(),
                "status": question["status"],
                "titlePreview": _blocks_text(question["stem"]["blocks"])[:160],
                "tags": tags,
                "contentHash": question["integrity"]["contentHash"],
                "changeSummary": change_summary_by_qid.get(qid, ""),
                "source": {
                    "documentId": question["source"]["documentId"],
                    "slideNumber": question["source"]["slideNumber"],
                    "questionIndex": question["source"]["questionIndex"],
                },
                "answerSummary": {
                    "correctChoiceId": question["answerKey"]["correctChoiceId"],
                    "choices": [
                        {
                            "id": choice["id"],
                            "label": choice.get("label", choice["id"]),
                            "displayOrder": choice["displayOrder"],
                        }
                        for choice in question["choices"]
                    ],
                },
            }
        )

    pack_hash = _hash_json([entry["contentHash"] for entry in question_index])
    manifest = {
        "format": "quail-ultra-qbank",
        "schemaVersion": 1,
        "packId": _slug(pack_id, "qbank"),
        "title": title or data.get("title") or f"{pack_id} QBank",
        "rotation": data.get("rotation", ""),
        "description": data.get("description", ""),
        "createdAt": existing_manifest.get("createdAt") if existing_manifest else data.get("createdAt", "1970-01-01T00:00:00Z"),
        "updatedAt": data.get("updatedAt", "1970-01-01T00:00:00Z"),
        "producer": {
            "name": "qbank-parser",
            "version": str(data.get("parser_version", "0.1.0")),
            "gitCommit": str(data.get("git_commit", "")),
            "schemaChecksum": schema_checksum(),
        },
        "revision": {
            "number": int(existing_manifest.get("revision", {}).get("number", 0)) + 1 if existing_manifest else 1,
            "hash": pack_hash,
            **({"previousHash": existing_manifest.get("revision", {}).get("hash", "")} if existing_manifest else {}),
        },
        "questionIndex": question_index,
        "tagIndex": {key: sorted(values) for key, values in tag_index.items()},
        "mediaIndex": sorted(media_by_id.values(), key=lambda media: str(media.get("id", ""))),
        "validation": {
            "status": "passed",
            "errors": [],
            "warnings": [],
            "blockedQuestionCount": 0,
        },
    }
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    pack_state.save(state_path)

    validation_errors = validate_native_pack_directory(target_dir)
    qa_report_json, qa_report_markdown = _write_native_sample_report(
        target_dir=target_dir,
        source_questions=source_questions,
        native_questions=native_questions,
        excluded=excluded,
        validation_errors=validation_errors,
    )
    if validation_errors:
        raise ValueError("Native Quail export failed validation: " + "; ".join(validation_errors[:10]))

    logger_fn(f"Native Quail pack written: {target_dir}")
    logger_fn(f"Questions: {len(native_questions)}")
    return NativeQuailExportSummary(
        source_json=source_path,
        output_dir=target_dir,
        mode="append" if append else "fresh",
        questions_written=written_count,
        questions_added=added_count,
        questions_updated=updated_count,
        questions_skipped=skipped_count,
        total_questions=len(native_questions),
        media_files_copied=copied_count,
        validation_errors=validation_errors,
        qa_report_json=qa_report_json,
        qa_report_markdown=qa_report_markdown,
    )


__all__ = [
    "NativeQuailExportSummary",
    "export_native_quail_qbank",
]
