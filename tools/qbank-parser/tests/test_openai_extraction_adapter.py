from __future__ import annotations

from providers.extraction.openai_adapter import OPENAI_EXTRACTION_SCHEMA, OpenAIExtractionAdapter


def test_openai_extraction_request_payload_snapshot():
    payload = OpenAIExtractionAdapter.build_request_payload(
        user_content=[{"type": "input_text", "text": "extract"}],
        model_name="gpt-4.1-mini",
    )

    assert payload["model"] == "gpt-4.1-mini"
    assert payload["input"] == [{"role": "user", "content": [{"type": "input_text", "text": "extract"}]}]
    assert payload["timeout"] == 90
    assert payload["text"]["format"]["type"] == "json_schema"
    assert payload["text"]["format"]["name"] == "extracted_questions"
    assert payload["text"]["format"]["strict"] is True
    assert payload["text"]["format"]["schema"] == OPENAI_EXTRACTION_SCHEMA


def test_openai_extraction_schema_requires_all_question_properties():
    item_schema = OPENAI_EXTRACTION_SCHEMA["properties"]["questions"]["items"]

    assert sorted(item_schema["required"]) == sorted(item_schema["properties"].keys())


def test_parse_question_entries_classifies_vision_images():
    adapter = OpenAIExtractionAdapter.__new__(OpenAIExtractionAdapter)

    results = adapter._parse_question_entries(
        data={
            "slide_has_questions": True,
            "question_count": 1,
            "questions": [
                {
                    "question_number": 1,
                    "variant_label": "",
                    "is_valid_question": True,
                    "question_stem": "stem",
                    "question_image_numbers": [2],
                    "explanation_image_numbers": [3],
                    "choices": {"A": "a", "B": "b", "C": "c", "D": "d", "E": ""},
                    "correct_answer": "A",
                    "correct_answer_text": "a",
                    "confidence": 88,
                    "explanation": "because",
                    "flags": [],
                    "source_of_answer": "visual_highlight",
                }
            ],
        },
        slide_number=9,
        extraction_method="vision",
        images=["/tmp/img1.png", "/tmp/img2.png", "/tmp/img3.png"],
    )

    assert len(results) == 1
    assert results[0].images == ["/tmp/img2.png"]
    assert results[0].explanation_images == ["/tmp/img1.png", "/tmp/img3.png"]


def test_parse_question_entries_hides_text_path_images_until_answer():
    adapter = OpenAIExtractionAdapter.__new__(OpenAIExtractionAdapter)

    results = adapter._parse_question_entries(
        data={
            "slide_has_questions": True,
            "question_count": 1,
            "questions": [
                {
                    "question_number": 1,
                    "variant_label": "",
                    "is_valid_question": True,
                    "question_stem": "stem",
                    "choices": {"A": "a", "B": "b", "C": "c", "D": "d", "E": ""},
                    "correct_answer": "A",
                    "correct_answer_text": "a",
                    "confidence": 88,
                    "explanation": "because",
                    "flags": [],
                    "source_of_answer": "notes",
                }
            ],
        },
        slide_number=10,
        extraction_method="text",
        images=["/tmp/img1.png", "/tmp/img2.png"],
    )

    assert len(results) == 1
    assert results[0].images == []
    assert results[0].explanation_images == ["/tmp/img1.png", "/tmp/img2.png"]
