from __future__ import annotations

from ai.gemini_processor import ExtractedQuestion as LegacyExtractedQuestion
from domain.models import ExtractedQuestion, SlideContent, USMLEQuestion
from export.usmle_formatter import USMLEQuestion as LegacyUSMLEQuestion
from parsers.pptx_parser import SlideContent as LegacySlideContent


def test_extracted_question_to_dict_round_trip():
    question = ExtractedQuestion(
        slide_number=7,
        question_index=2,
        variant_label="Version A",
        is_valid_question=True,
        question_stem="What is the diagnosis?",
        choices={"A": "A", "B": "B", "C": "C", "D": "D", "E": "E"},
        correct_answer="B",
        correct_answer_text="B",
        confidence=82,
        explanation="Because",
        flags=["needs-check"],
        source_of_answer="highlighted",
        rotation="Internal Medicine",
        images=["/tmp/slide.png"],
        explanation_images=["/tmp/explainer.png"],
        extraction_method="vision",
        comments=[{"author": "u", "content": "c"}],
        error="",
    )

    payload = question.to_dict()
    restored = ExtractedQuestion(**payload)

    assert restored.to_dict() == payload
    assert restored.needs_review() is True


def test_slide_content_to_dict_round_trip():
    slide = SlideContent(
        slide_number=3,
        texts=["line1", "line2"],
        speaker_notes="notes",
        highlighted_texts=["answer"],
        potential_correct_answer="A",
        images=["/tmp/image.png"],
        slide_image_path="/tmp/slide.png",
    )

    payload = slide.to_dict()
    restored = SlideContent(**payload)

    assert restored.to_dict() == payload


def test_usmle_question_dict_round_trip():
    question = USMLEQuestion(
        original_slide_number=12,
        question_id="deck-12",
        variant_label="Version B",
        question_stem="A patient presents with...",
        question="Most likely diagnosis?",
        choices={"A": "A", "B": "B", "C": "C", "D": "D", "E": "E"},
        correct_answer="D",
        correct_answer_explanation="Reasoning",
        incorrect_explanations={"A": "x", "B": "x", "C": "x", "E": "x"},
        educational_objective="Pearl",
        tags={"rotation": "Pediatrics", "topic": "Infectious Disease"},
        images=["/tmp/image.png"],
        explanation_images=["/tmp/explainer.png"],
        grounding_sources=["src1"],
        comments=[{"author": "attending", "content": "note"}],
        error="",
    )

    payload = question.to_dict()
    restored = USMLEQuestion.from_dict(payload)

    assert restored.to_dict() == payload


def test_usmle_question_markdown_places_explanation_images_after_answer():
    question = USMLEQuestion(
        original_slide_number=12,
        question_id="deck-12",
        question_stem="A patient presents with...",
        question="Most likely diagnosis?",
        choices={"A": "A", "B": "B", "C": "C", "D": "D", "E": "E"},
        correct_answer="D",
        correct_answer_explanation="Reasoning",
        incorrect_explanations={"A": "x"},
        educational_objective="Pearl",
        tags={"rotation": "Pediatrics", "topic": "Infectious Disease"},
        images=["/tmp/question.png"],
        explanation_images=["/tmp/explainer.png"],
    )

    markdown = question.to_markdown()

    assert markdown.index("/tmp/question.png") < markdown.index("## Question")
    assert markdown.index("### Correct Answer: D") < markdown.index("/tmp/explainer.png")


def test_legacy_import_paths_remain_compatible():
    assert LegacyExtractedQuestion is ExtractedQuestion
    assert LegacySlideContent is SlideContent
    assert LegacyUSMLEQuestion is USMLEQuestion
