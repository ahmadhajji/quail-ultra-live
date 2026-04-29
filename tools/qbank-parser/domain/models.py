"""Shared dataclasses used across parsing, extraction, and formatting."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal


ExtractionClassification = Literal["accepted", "needs_review", "rejected", "error"]
ReviewStatus = Literal["approved", "edited", "rekeyed", "rejected", "skipped", "quit", "pending"]


def _normalize_classification(
    classification: str,
    *,
    is_valid_question: bool | None,
    error: str,
) -> ExtractionClassification:
    if error:
        return "error"
    cleaned = str(classification or "").strip().lower()
    if cleaned in {"accepted", "needs_review", "rejected", "error"}:
        return cleaned  # type: ignore[return-value]
    if is_valid_question is False:
        return "rejected"
    return "accepted"


@dataclass
class ExtractedQuestion:
    """Structured question extracted from a source slide."""

    slide_number: int
    question_index: int = 1
    question_id: str = ""
    variant_label: str = ""
    classification: ExtractionClassification = "accepted"
    # Compatibility shim for old construction paths; not emitted in JSON.
    is_valid_question: bool | None = None
    review_status: ReviewStatus = "pending"
    review_reasons: list[str] = field(default_factory=list)
    validation: dict = field(default_factory=dict)
    question_stem: str = ""
    choices: dict = field(default_factory=dict)
    correct_answer: str = ""
    correct_answer_text: str = ""
    confidence: int = 0
    explanation: str = ""
    flags: list = field(default_factory=list)
    source_of_answer: str = ""
    rotation: str = ""
    images: list = field(default_factory=list)
    explanation_images: list = field(default_factory=list)
    extraction_method: str = "text"
    comments: list = field(default_factory=list)
    deck_id: str = ""
    source_group_id: str = ""
    source_slide_path: str = ""
    slide_consensus_status: str = ""
    related_question_ids: list[str] = field(default_factory=list)
    dedupe_fingerprint: str = ""
    warnings: list[str] = field(default_factory=list)
    fact_check: dict = field(default_factory=dict)
    proposed_correct_answer: str = ""
    proposed_correct_answer_text: str = ""
    raw_model_payload: dict = field(default_factory=dict)
    raw_model_text: str = ""
    raw_response: str = ""
    error: str = ""

    def __post_init__(self):
        """Normalize identifiers and adjudication defaults."""
        if not self.question_id:
            if self.question_index > 1:
                self.question_id = f"{self.slide_number}.{self.question_index}"
            else:
                self.question_id = str(self.slide_number)

        self.classification = _normalize_classification(
            self.classification,
            is_valid_question=self.is_valid_question,
            error=self.error,
        )
        if self.classification == "accepted" and self.review_status == "pending":
            # Accepted items are system-approved unless a human later changes them.
            self.review_status = "approved"

    @classmethod
    def from_dict(cls, data: dict) -> "ExtractedQuestion":
        return cls(
            slide_number=data.get("slide_number", 0),
            question_index=data.get("question_index", 1),
            question_id=data.get("question_id", ""),
            variant_label=data.get("variant_label", ""),
            classification=data.get("classification", ""),
            is_valid_question=data.get("is_valid_question"),
            review_status=data.get("review_status", "pending"),
            review_reasons=data.get("review_reasons", []),
            validation=data.get("validation", {}),
            question_stem=data.get("question_stem", ""),
            choices=data.get("choices", {}),
            correct_answer=data.get("correct_answer", ""),
            correct_answer_text=data.get("correct_answer_text", ""),
            confidence=data.get("confidence", 0),
            explanation=data.get("explanation", ""),
            flags=data.get("flags", []),
            source_of_answer=data.get("source_of_answer", ""),
            rotation=data.get("rotation", ""),
            images=data.get("images", []),
            explanation_images=data.get("explanation_images", []),
            extraction_method=data.get("extraction_method", "text"),
            comments=data.get("comments", []),
            deck_id=data.get("deck_id", ""),
            source_group_id=data.get("source_group_id", ""),
            source_slide_path=data.get("source_slide_path", ""),
            slide_consensus_status=data.get("slide_consensus_status", ""),
            related_question_ids=data.get("related_question_ids", []),
            dedupe_fingerprint=data.get("dedupe_fingerprint", ""),
            warnings=data.get("warnings", []),
            fact_check=data.get("fact_check", {}),
            proposed_correct_answer=data.get("proposed_correct_answer", ""),
            proposed_correct_answer_text=data.get("proposed_correct_answer_text", ""),
            raw_model_payload=data.get("raw_model_payload", {}),
            raw_model_text=data.get("raw_model_text", ""),
            raw_response=data.get("raw_response", ""),
            error=data.get("error", ""),
        )

    def to_dict(self) -> dict:
        return {
            "slide_number": self.slide_number,
            "question_index": self.question_index,
            "question_id": self.question_id,
            "variant_label": self.variant_label,
            "classification": self.classification,
            "review_status": self.review_status,
            "review_reasons": self.review_reasons,
            "validation": self.validation,
            "question_stem": self.question_stem,
            "choices": self.choices,
            "correct_answer": self.correct_answer,
            "correct_answer_text": self.correct_answer_text,
            "confidence": self.confidence,
            "explanation": self.explanation,
            "flags": self.flags,
            "source_of_answer": self.source_of_answer,
            "rotation": self.rotation,
            "images": self.images,
            "explanation_images": self.explanation_images,
            "extraction_method": self.extraction_method,
            "comments": self.comments,
            "deck_id": self.deck_id,
            "source_group_id": self.source_group_id,
            "source_slide_path": self.source_slide_path,
            "slide_consensus_status": self.slide_consensus_status,
            "related_question_ids": self.related_question_ids,
            "dedupe_fingerprint": self.dedupe_fingerprint,
            "warnings": self.warnings,
            "fact_check": self.fact_check,
            "proposed_correct_answer": self.proposed_correct_answer,
            "proposed_correct_answer_text": self.proposed_correct_answer_text,
            "raw_model_payload": self.raw_model_payload,
            "raw_model_text": self.raw_model_text,
            "raw_response": self.raw_response,
            "error": self.error,
        }

    def needs_review(self) -> bool:
        """Check if this question requires human attention."""
        if self.classification == "needs_review":
            return True
        if self.classification != "accepted":
            return False
        if self.confidence < 70:
            return True
        if self.flags:
            return True
        if not self.correct_answer:
            return True
        if self.extraction_method == "vision":
            return True
        return False

    def is_reviewable(self) -> bool:
        return self.classification in {"accepted", "needs_review", "rejected", "error"}

    def is_approved_for_formatting(self) -> bool:
        return self.review_status in {"approved", "edited", "rekeyed"} and self.classification == "accepted"

    def is_exportable_for_formatting(self) -> bool:
        """Question can be formatted/exported even when carrying review-risk metadata."""
        return self.classification in {"accepted", "needs_review"} and self.review_status not in {
            "rejected",
            "skipped",
            "quit",
        }

    def is_blocking_export(self) -> bool:
        return self.classification in {"needs_review", "rejected", "error"} or self.review_status in {
            "pending",
            "quit",
            "skipped",
            "rejected",
        }


@dataclass
class SlideContent:
    """Structured content extracted from a single slide."""

    slide_number: int
    texts: list[str] = field(default_factory=list)
    speaker_notes: str = ""
    highlighted_texts: list[str] = field(default_factory=list)
    potential_correct_answer: str = ""
    images: list[str] = field(default_factory=list)
    slide_image_path: str = ""
    slide_consensus_status: str = ""
    raw_shapes_info: list[dict] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "slide_number": self.slide_number,
            "texts": self.texts,
            "speaker_notes": self.speaker_notes,
            "highlighted_texts": self.highlighted_texts,
            "potential_correct_answer": self.potential_correct_answer,
            "images": self.images,
            "slide_image_path": self.slide_image_path,
            "slide_consensus_status": self.slide_consensus_status,
        }


@dataclass
class USMLEQuestion:
    """A fully formatted USMLE-style question."""

    original_slide_number: int
    original_question_index: int = 1
    question_id: str = ""
    variant_label: str = ""
    question_stem: str = ""
    question: str = ""
    choices: dict = field(default_factory=dict)
    correct_answer: str = ""
    correct_answer_explanation: str = ""
    incorrect_explanations: dict = field(default_factory=dict)
    educational_objective: str = ""
    tags: dict = field(default_factory=dict)
    images: list = field(default_factory=list)
    explanation_images: list = field(default_factory=list)
    grounding_sources: list = field(default_factory=list)
    comments: list = field(default_factory=list)
    deck_id: str = ""
    source_group_id: str = ""
    source_slide_path: str = ""
    slide_consensus_status: str = ""
    related_question_ids: list[str] = field(default_factory=list)
    dedupe_fingerprint: str = ""
    warnings: list[str] = field(default_factory=list)
    fact_check: dict = field(default_factory=dict)
    extraction_classification: str = ""
    review_status: str = "pending"
    review_reasons: list[str] = field(default_factory=list)
    validation: dict = field(default_factory=dict)
    choice_text_by_letter: dict = field(default_factory=dict)
    choice_presentation: dict = field(default_factory=dict)
    raw_response: str = ""
    error: str = ""

    def to_dict(self) -> dict:
        return {
            "question_id": self.question_id,
            "original_slide_number": self.original_slide_number,
            "original_question_index": self.original_question_index,
            "variant_label": self.variant_label,
            "question_stem": self.question_stem,
            "question": self.question,
            "choices": self.choices,
            "correct_answer": self.correct_answer,
            "correct_answer_explanation": self.correct_answer_explanation,
            "incorrect_explanations": self.incorrect_explanations,
            "educational_objective": self.educational_objective,
            "tags": self.tags,
            "images": self.images,
            "explanation_images": self.explanation_images,
            "grounding_sources": self.grounding_sources,
            "comments": self.comments,
            "deck_id": self.deck_id,
            "source_group_id": self.source_group_id,
            "source_slide_path": self.source_slide_path,
            "slide_consensus_status": self.slide_consensus_status,
            "related_question_ids": self.related_question_ids,
            "dedupe_fingerprint": self.dedupe_fingerprint,
            "warnings": self.warnings,
            "fact_check": self.fact_check,
            "extraction_classification": self.extraction_classification,
            "review_status": self.review_status,
            "review_reasons": self.review_reasons,
            "validation": self.validation,
            "choice_text_by_letter": self.choice_text_by_letter,
            "choice_presentation": self.choice_presentation,
            "raw_response": self.raw_response,
            "error": self.error,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "USMLEQuestion":
        return cls(
            original_slide_number=data.get("original_slide_number", 0),
            original_question_index=data.get("original_question_index", 1),
            question_id=data.get("question_id", ""),
            variant_label=data.get("variant_label", ""),
            question_stem=data.get("question_stem", ""),
            question=data.get("question", ""),
            choices=data.get("choices", {}),
            correct_answer=data.get("correct_answer", ""),
            correct_answer_explanation=data.get("correct_answer_explanation", ""),
            incorrect_explanations=data.get("incorrect_explanations", {}),
            educational_objective=data.get("educational_objective", ""),
            tags=data.get("tags", {}),
            images=data.get("images", []),
            explanation_images=data.get("explanation_images", []),
            grounding_sources=data.get("grounding_sources", []),
            comments=data.get("comments", []),
            deck_id=data.get("deck_id", ""),
            source_group_id=data.get("source_group_id", ""),
            source_slide_path=data.get("source_slide_path", ""),
            slide_consensus_status=data.get("slide_consensus_status", ""),
            related_question_ids=data.get("related_question_ids", []),
            dedupe_fingerprint=data.get("dedupe_fingerprint", ""),
            warnings=data.get("warnings", []),
            fact_check=data.get("fact_check", {}),
            extraction_classification=data.get("extraction_classification", ""),
            review_status=data.get("review_status", "pending"),
            review_reasons=data.get("review_reasons", []),
            validation=data.get("validation", {}),
            choice_text_by_letter=data.get("choice_text_by_letter", {}),
            choice_presentation=data.get("choice_presentation", {}),
            raw_response=data.get("raw_response", ""),
            error=data.get("error", ""),
        )

    def to_markdown(self) -> str:
        """Format as markdown for display/export with embedded images."""
        md_parts: list[str] = []

        md_parts.append(f"**Question ID: {self.question_id}** (Slide {self.original_slide_number})\n\n")

        if self.images:
            md_parts.append("### Clinical Image(s)\n\n")
            for img_path in self.images:
                md_parts.append(f"![Slide {self.original_slide_number} Image]({img_path})\n\n")

        md_parts.append("## Question\n")
        md_parts.append(self.question_stem)
        md_parts.append(f"\n\n**{self.question}**\n")

        md_parts.append("\n### Answer Choices\n")
        for letter, text in self.choices.items():
            if letter == self.correct_answer:
                md_parts.append(f"**{letter}. {text}** ✅\n")
            else:
                md_parts.append(f"{letter}. {text}\n")

        md_parts.append(f"\n### Correct Answer: {self.correct_answer}\n")
        md_parts.append(f"\n{self.correct_answer_explanation}\n")

        if self.explanation_images:
            md_parts.append("\n### Explanation Image(s)\n\n")
            for img_path in self.explanation_images:
                md_parts.append(f"![Slide {self.original_slide_number} Explanation Image]({img_path})\n\n")

        md_parts.append("\n### Incorrect Answer Explanations\n")
        for letter, explanation in self.incorrect_explanations.items():
            md_parts.append(f"**({letter})** {explanation}\n\n")

        md_parts.append("\n### Educational Objective\n")
        md_parts.append(self.educational_objective)

        md_parts.append("\n\n### Tags\n")
        md_parts.append(f"- **Rotation:** {self.tags.get('rotation', 'N/A')}\n")
        md_parts.append(f"- **Topic:** {self.tags.get('topic', 'N/A')}\n")

        if self.grounding_sources:
            md_parts.append("\n### Sources (Fact-Checked)\n")
            for source in self.grounding_sources[:3]:
                md_parts.append(f"- {source}\n")

        if self.comments:
            md_parts.append("\n### Original Question Comments\n")
            for comment in self.comments:
                author = comment.get("author", "Unknown")
                content = comment.get("content", "")
                if content:
                    md_parts.append(f"**{author}:** {content}\n\n")

        return "".join(md_parts)


# ---------------------------------------------------------------------------
# v2 pipeline models
#
# Built for the simplified 4-stage pipeline (raw extract -> detect -> rewrite ->
# native pack). Lives alongside the old ExtractedQuestion / USMLEQuestion until
# the migration is complete (see docs/v2-migration-kill-list.md), at which
# point the old models are deleted.
# ---------------------------------------------------------------------------


def _stable_hash(payload: dict) -> str:
    """Deterministic SHA-256 hash of a dict payload (sorted keys, no whitespace)."""
    serialized = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def _file_hash(path_value: str) -> str:
    if not path_value:
        return ""
    try:
        path = Path(path_value)
        if not path.exists() or not path.is_file():
            return f"missing:{path.name}"
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except OSError:
        return "unreadable"


@dataclass
class RawSlide:
    """All raw content extracted from a single slide. No AI involvement.

    Stage 1 output. Used as input to Stage 2 (detection).
    """

    slide_number: int
    deck_id: str = ""
    text_blocks: list[str] = field(default_factory=list)
    speaker_notes: str = ""
    highlighted_texts: list[str] = field(default_factory=list)
    potential_correct_answer: str = ""
    image_paths: list[str] = field(default_factory=list)
    slide_screenshot_path: str = ""
    comments: list[dict] = field(default_factory=list)

    def content_hash(self) -> str:
        """Stable hash of content fields used by Stage 2 cache key.

        Excludes path-dependent fields (image_paths, slide_screenshot_path)
        so the same slide content hashes the same regardless of where files
        live on disk.
        """
        return _stable_hash(
            {
                "deck_id": self.deck_id,
                "slide_number": self.slide_number,
                "text_blocks": self.text_blocks,
                "speaker_notes": self.speaker_notes,
                "highlighted_texts": self.highlighted_texts,
                "potential_correct_answer": self.potential_correct_answer,
                "image_hashes": [_file_hash(path) for path in self.image_paths],
                "slide_screenshot_hash": _file_hash(self.slide_screenshot_path),
                "comment_contents": [c.get("content", "") for c in self.comments],
            }
        )

    def to_dict(self) -> dict:
        return {
            "slide_number": self.slide_number,
            "deck_id": self.deck_id,
            "text_blocks": self.text_blocks,
            "speaker_notes": self.speaker_notes,
            "highlighted_texts": self.highlighted_texts,
            "potential_correct_answer": self.potential_correct_answer,
            "image_paths": self.image_paths,
            "slide_screenshot_path": self.slide_screenshot_path,
            "comments": self.comments,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "RawSlide":
        return cls(
            slide_number=data.get("slide_number", 0),
            deck_id=data.get("deck_id", ""),
            text_blocks=data.get("text_blocks", []),
            speaker_notes=data.get("speaker_notes", ""),
            highlighted_texts=data.get("highlighted_texts", []),
            potential_correct_answer=data.get("potential_correct_answer", ""),
            image_paths=data.get("image_paths", []),
            slide_screenshot_path=data.get("slide_screenshot_path", ""),
            comments=data.get("comments", []),
        )


DetectionStatus = Literal["ok", "needs_review", "error"]


@dataclass
class DetectedQuestion:
    """A question identified from a slide by Stage 2 detection.

    Carries forward source provenance (speaker notes, comments, slide path)
    into Stage 3 so the rewrite has the same authoritative context.
    """

    deck_id: str
    slide_number: int
    question_index: int = 1
    question_id: str = ""

    # Detected content (may be messy; Stage 3 rewrites it)
    stem_text: str = ""
    choices: dict = field(default_factory=dict)
    correct_answer: str = ""
    explanation_hint: str = ""

    # Media classification (preserved into Stage 3)
    stem_image_paths: list[str] = field(default_factory=list)
    explanation_image_paths: list[str] = field(default_factory=list)

    # Authoritative context carried forward
    source_slide_path: str = ""
    speaker_notes: str = ""
    comments: list[dict] = field(default_factory=list)
    highlighted_texts: list[str] = field(default_factory=list)

    # Quality signals
    confidence: int = 0
    status: DetectionStatus = "ok"
    detection_warnings: list[str] = field(default_factory=list)
    error: str = ""

    # Provenance (for debugging and cache invalidation)
    detect_model: str = ""
    detect_prompt_version: str = ""

    def __post_init__(self):
        if not self.question_id:
            if self.question_index > 1:
                self.question_id = f"{self.slide_number}.{self.question_index}"
            else:
                self.question_id = str(self.slide_number)

    def content_hash(self) -> str:
        """Stable hash for Stage 3 cache key.

        Includes only inputs that change the rewrite output. Excludes
        confidence/warnings/status which are downstream-only signals.
        """
        return _stable_hash(
            {
                "deck_id": self.deck_id,
                "slide_number": self.slide_number,
                "question_index": self.question_index,
                "stem_text": self.stem_text,
                "choices": self.choices,
                "correct_answer": self.correct_answer,
                "explanation_hint": self.explanation_hint,
                "speaker_notes": self.speaker_notes,
                "comments": [c.get("content", "") for c in self.comments],
                "highlighted_texts": self.highlighted_texts,
                "source_slide_hash": _file_hash(self.source_slide_path),
                "stem_image_hashes": [_file_hash(path) for path in self.stem_image_paths],
                "explanation_image_hashes": [_file_hash(path) for path in self.explanation_image_paths],
            }
        )

    def to_dict(self) -> dict:
        return {
            "deck_id": self.deck_id,
            "slide_number": self.slide_number,
            "question_index": self.question_index,
            "question_id": self.question_id,
            "stem_text": self.stem_text,
            "choices": self.choices,
            "correct_answer": self.correct_answer,
            "explanation_hint": self.explanation_hint,
            "stem_image_paths": self.stem_image_paths,
            "explanation_image_paths": self.explanation_image_paths,
            "source_slide_path": self.source_slide_path,
            "speaker_notes": self.speaker_notes,
            "comments": self.comments,
            "highlighted_texts": self.highlighted_texts,
            "confidence": self.confidence,
            "status": self.status,
            "detection_warnings": self.detection_warnings,
            "error": self.error,
            "detect_model": self.detect_model,
            "detect_prompt_version": self.detect_prompt_version,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "DetectedQuestion":
        status = data.get("status", "ok")
        if status not in ("ok", "needs_review", "error"):
            status = "ok"
        return cls(
            deck_id=data.get("deck_id", ""),
            slide_number=data.get("slide_number", 0),
            question_index=data.get("question_index", 1),
            question_id=data.get("question_id", ""),
            stem_text=data.get("stem_text", ""),
            choices=data.get("choices", {}),
            correct_answer=data.get("correct_answer", ""),
            explanation_hint=data.get("explanation_hint", ""),
            stem_image_paths=data.get("stem_image_paths", []),
            explanation_image_paths=data.get("explanation_image_paths", []),
            source_slide_path=data.get("source_slide_path", ""),
            speaker_notes=data.get("speaker_notes", ""),
            comments=data.get("comments", []),
            highlighted_texts=data.get("highlighted_texts", []),
            confidence=data.get("confidence", 0),
            status=status,
            detection_warnings=data.get("detection_warnings", []),
            error=data.get("error", ""),
            detect_model=data.get("detect_model", ""),
            detect_prompt_version=data.get("detect_prompt_version", ""),
        )


@dataclass
class RewrittenQuestion:
    """A fully USMLE-rewritten question ready for native pack export.

    Stage 3 output. Stage 4 transforms this into the native pack JSON
    contract via export/native_quail_export.py.
    """

    deck_id: str
    slide_number: int
    question_index: int = 1
    question_id: str = ""

    # Final clean content
    stem: str = ""
    choices: dict = field(default_factory=dict)
    correct_answer: str = ""

    # Rich explanation
    correct_explanation: str = ""
    incorrect_explanations: dict = field(default_factory=dict)
    educational_objective: str = ""

    # Tags
    rotation: str = ""
    topic: str = ""

    # Media
    stem_image_paths: list[str] = field(default_factory=list)
    explanation_image_paths: list[str] = field(default_factory=list)
    source_slide_path: str = ""

    # Provenance carried forward
    comments: list[dict] = field(default_factory=list)

    # Quality
    warnings: list[str] = field(default_factory=list)
    error: str = ""

    # Provenance for debugging
    detect_model: str = ""
    rewrite_model: str = ""
    rewrite_prompt_version: str = ""

    def __post_init__(self):
        if not self.question_id:
            if self.question_index > 1:
                self.question_id = f"{self.slide_number}.{self.question_index}"
            else:
                self.question_id = str(self.slide_number)

    def is_complete(self) -> bool:
        """True when the question has all fields required by the native pack."""
        if self.error:
            return False
        if not self.stem.strip():
            return False
        if len(self.choices) < 4 or len(self.choices) > 5:
            return False
        if not all(str(text).strip() for text in self.choices.values()):
            return False
        if self.correct_answer not in self.choices:
            return False
        if not self.correct_explanation.strip():
            return False
        if not self.educational_objective.strip():
            return False
        # Every non-correct choice must have an incorrect explanation
        for letter in self.choices:
            if letter == self.correct_answer:
                continue
            if not str(self.incorrect_explanations.get(letter, "")).strip():
                return False
        if not self.rotation.strip() or not self.topic.strip():
            return False
        return True

    def to_dict(self) -> dict:
        return {
            "deck_id": self.deck_id,
            "slide_number": self.slide_number,
            "question_index": self.question_index,
            "question_id": self.question_id,
            "stem": self.stem,
            "choices": self.choices,
            "correct_answer": self.correct_answer,
            "correct_explanation": self.correct_explanation,
            "incorrect_explanations": self.incorrect_explanations,
            "educational_objective": self.educational_objective,
            "rotation": self.rotation,
            "topic": self.topic,
            "stem_image_paths": self.stem_image_paths,
            "explanation_image_paths": self.explanation_image_paths,
            "source_slide_path": self.source_slide_path,
            "comments": self.comments,
            "warnings": self.warnings,
            "error": self.error,
            "detect_model": self.detect_model,
            "rewrite_model": self.rewrite_model,
            "rewrite_prompt_version": self.rewrite_prompt_version,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "RewrittenQuestion":
        return cls(
            deck_id=data.get("deck_id", ""),
            slide_number=data.get("slide_number", 0),
            question_index=data.get("question_index", 1),
            question_id=data.get("question_id", ""),
            stem=data.get("stem", ""),
            choices=data.get("choices", {}),
            correct_answer=data.get("correct_answer", ""),
            correct_explanation=data.get("correct_explanation", ""),
            incorrect_explanations=data.get("incorrect_explanations", {}),
            educational_objective=data.get("educational_objective", ""),
            rotation=data.get("rotation", ""),
            topic=data.get("topic", ""),
            stem_image_paths=data.get("stem_image_paths", []),
            explanation_image_paths=data.get("explanation_image_paths", []),
            source_slide_path=data.get("source_slide_path", ""),
            comments=data.get("comments", []),
            warnings=data.get("warnings", []),
            error=data.get("error", ""),
            detect_model=data.get("detect_model", ""),
            rewrite_model=data.get("rewrite_model", ""),
            rewrite_prompt_version=data.get("rewrite_prompt_version", ""),
        )
