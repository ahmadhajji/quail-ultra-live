"""Shared dataclasses used across parsing, extraction, and formatting."""

from __future__ import annotations

from dataclasses import dataclass, field
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
