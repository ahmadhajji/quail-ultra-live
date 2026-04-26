from __future__ import annotations

import json
from types import SimpleNamespace

import main


def test_is_progress_compatible_checks_source_snapshot(tmp_path):
    deck = tmp_path / "deck.pptx"
    deck.write_bytes(b"deck-v1")

    progress_data = {
        "source_pptx_path": str(deck.resolve()),
        "source_size_bytes": deck.stat().st_size,
        "source_mtime_ns": deck.stat().st_mtime_ns,
        "total_slides": 10,
    }

    assert main.is_progress_compatible(progress_data, deck, total_slides=10) is True

    progress_data["source_size_bytes"] += 1
    assert main.is_progress_compatible(progress_data, deck, total_slides=10) is False


def test_is_progress_compatible_rejects_same_filename_different_path(tmp_path):
    deck_one_dir = tmp_path / "one"
    deck_two_dir = tmp_path / "two"
    deck_one_dir.mkdir(parents=True, exist_ok=True)
    deck_two_dir.mkdir(parents=True, exist_ok=True)

    deck_one = deck_one_dir / "deck.pptx"
    deck_two = deck_two_dir / "deck.pptx"
    deck_one.write_bytes(b"deck-v1")
    deck_two.write_bytes(b"deck-v1")

    progress_data = {
        "source_pptx_path": str(deck_one.resolve()),
        "source_size_bytes": deck_one.stat().st_size,
        "source_mtime_ns": deck_one.stat().st_mtime_ns,
        "total_slides": 10,
    }

    assert main.is_progress_compatible(progress_data, deck_two, total_slides=10) is False


def test_parse_presentation_ignores_progress_from_other_deck(monkeypatch, tmp_path):
    output_dir = tmp_path / "output"
    output_dir.mkdir(parents=True, exist_ok=True)

    deck = tmp_path / "deck.pptx"
    deck.write_bytes(b"deck")
    other_deck = tmp_path / "other.pptx"
    other_deck.write_bytes(b"other")

    progress_file = output_dir / "extraction_progress.json"
    progress_file.write_text(
        json.dumps(
            {
                "source_pptx_path": str(other_deck.resolve()),
                "source_size_bytes": other_deck.stat().st_size,
                "source_mtime_ns": other_deck.stat().st_mtime_ns,
                "total_slides": 2,
                "processed_slides": [1, 2],
                "questions": [
                    {
                        "slide_number": 99,
                        "question_index": 1,
                        "question_id": "99",
                        "is_valid_question": True,
                        "question_stem": "stale",
                        "choices": {"A": "old"},
                        "correct_answer": "A",
                        "correct_answer_text": "old",
                        "confidence": 50,
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    slides = [
        SimpleNamespace(
            slide_number=1,
            texts=["Question 1?"],
            speaker_notes="",
            highlighted_texts=[],
            potential_correct_answer="",
            images=[],
        ),
        SimpleNamespace(
            slide_number=2,
            texts=["Question 2?"],
            speaker_notes="",
            highlighted_texts=[],
            potential_correct_answer="",
            images=[],
        ),
    ]

    class DummyProcessor:
        def __init__(self, *_args, **_kwargs):
            pass

        def process_slide(self, slide_number, **_kwargs):
            return [
                main.ExtractedQuestion(
                    slide_number=slide_number,
                    is_valid_question=True,
                    question_stem=f"Question {slide_number}",
                    choices={"A": "One", "B": "Two"},
                    correct_answer="A",
                    correct_answer_text="One",
                    confidence=90,
                )
            ]

    monkeypatch.setattr(main, "parse_pptx", lambda *_args, **_kwargs: slides)
    monkeypatch.setattr(main, "OpenAIProcessor", DummyProcessor)
    monkeypatch.setattr(main, "OUTPUT_DIR", output_dir)
    monkeypatch.setattr(main, "OPENAI_API_KEY", "test-key")

    main.parse_presentation(
        str(deck),
        use_ai=True,
        use_google_api=False,
        generate_stats=False,
        ai_workers=1,
        checkpoint_every=1,
    )

    extracted_json = output_dir / "extracted_questions.json"
    data = json.loads(extracted_json.read_text(encoding="utf-8"))
    assert len(data.get("questions", [])) == 2
