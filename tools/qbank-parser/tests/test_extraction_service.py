from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import main
from app.extraction_service import ExtractionService, ExtractionServiceDeps
from domain.models import ExtractedQuestion


def _make_slides(count: int):
    slides = []
    for idx in range(1, count + 1):
        slides.append(
            SimpleNamespace(
                slide_number=idx,
                texts=[f"Question {idx}?"],
                speaker_notes="",
                highlighted_texts=[],
                potential_correct_answer="",
                images=[],
            )
        )
    return slides


class _DummyProcessor:
    def __init__(self, *_args, **_kwargs):
        pass

    def process_slide(self, slide_number, **_kwargs):
        return [
            ExtractedQuestion(
                slide_number=slide_number,
                is_valid_question=True,
                question_stem=f"Question {slide_number}",
                choices={"A": "One", "B": "Two"},
                correct_answer="A",
                correct_answer_text="One",
                confidence=90,
            )
        ]


def _build_deps(
    tmp_path: Path,
    *,
    parse_pptx,
    fetch_comments=lambda _id: [],
    get_comments_by_slide=lambda _comments: {},
    save_progress=lambda **_kwargs: None,
    export_sink: dict | None = None,
):
    output_dir = tmp_path / "output"
    output_dir.mkdir(parents=True, exist_ok=True)

    if export_sink is None:
        export_sink = {}

    def export_to_json(questions, output_path, *_args, **_kwargs):
        export_sink["questions"] = [q.to_dict() for q in questions]
        payload = {
            "total_slides": len({q.slide_number for q in questions}),
            "valid_questions": sum(1 for q in questions if q.is_valid_question),
            "questions": [q.to_dict() for q in questions],
        }
        output_path.write_text(json.dumps(payload), encoding="utf-8")
        return output_path

    def export_to_csv(_questions, output_path, *_args, **_kwargs):
        output_path.write_text("slide_number,question_id\n", encoding="utf-8")
        return output_path

    deps = ExtractionServiceDeps(
        console=main.console,
        print_banner=lambda: None,
        parse_pptx=parse_pptx,
        fetch_comments=fetch_comments,
        get_comments_by_slide=get_comments_by_slide,
        openai_processor_cls=_DummyProcessor,
        export_to_json=export_to_json,
        export_to_csv=export_to_csv,
        save_progress=save_progress,
        is_progress_compatible=main.is_progress_compatible,
        get_speed_profile_config=main.get_speed_profile_config,
        question_sort_key=main.question_sort_key,
        output_dir=output_dir,
        openai_api_key="test-key",
        openai_extraction_model="gpt-4.1-mini",
        google_slides_id="env-id",
        stats_available=False,
    )
    return deps, export_sink


def test_service_ignores_progress_from_other_deck(tmp_path):
    deck = tmp_path / "deck.pptx"
    deck.write_bytes(b"deck")
    other_deck = tmp_path / "other.pptx"
    other_deck.write_bytes(b"other")

    deps, export_sink = _build_deps(tmp_path, parse_pptx=lambda *_args, **_kwargs: _make_slides(2))
    progress_file = deps.output_dir / "extraction_progress.json"
    progress_file.write_text(
        json.dumps(
            {
                "source_pptx_path": str(other_deck.resolve()),
                "source_size_bytes": other_deck.stat().st_size,
                "source_mtime_ns": other_deck.stat().st_mtime_ns,
                "total_slides": 2,
                "processed_slides": [1, 2],
                "questions": [{"slide_number": 99, "question_index": 1, "question_id": "99"}],
            }
        ),
        encoding="utf-8",
    )

    service = ExtractionService(deps)
    ok = service.run_parse_presentation(
        str(deck),
        use_ai=True,
        use_google_api=False,
        generate_stats=False,
        ai_workers=1,
        checkpoint_every=1,
    )

    assert ok is True
    assert [q["slide_number"] for q in export_sink["questions"]] == [1, 2]


def test_service_checkpoints_every_n_slides(tmp_path):
    deck = tmp_path / "deck.pptx"
    deck.write_bytes(b"deck")

    calls = {"count": 0}

    def save_progress(**_kwargs):
        calls["count"] += 1

    deps, _ = _build_deps(
        tmp_path,
        parse_pptx=lambda *_args, **_kwargs: _make_slides(3),
        save_progress=save_progress,
    )

    service = ExtractionService(deps)
    ok = service.run_parse_presentation(
        str(deck),
        use_ai=True,
        use_google_api=False,
        generate_stats=False,
        ai_workers=1,
        checkpoint_every=1,
    )

    assert ok is True
    assert calls["count"] == 3


def test_service_applies_slide_limits_before_ai_extraction(tmp_path):
    deck = tmp_path / "deck.pptx"
    deck.write_bytes(b"deck")

    deps, export_sink = _build_deps(tmp_path, parse_pptx=lambda *_args, **_kwargs: _make_slides(10))

    service = ExtractionService(deps)
    ok = service.run_parse_presentation(
        str(deck),
        use_ai=True,
        use_google_api=False,
        generate_stats=False,
        ai_workers=1,
        checkpoint_every=1,
        slide_range=(3, 8),
        max_slides=2,
    )

    assert ok is True
    assert [q["slide_number"] for q in export_sink["questions"]] == [3, 4]


def test_service_google_comments_attached_to_results(tmp_path):
    deck = tmp_path / "deck.pptx"
    deck.write_bytes(b"deck")
    comment = SimpleNamespace(author="Reviewer", content="Important clue")
    captured = {"presentation_id": ""}

    def fetch_comments(presentation_id: str):
        captured["presentation_id"] = presentation_id
        return [comment]

    def get_comments_by_slide(_comments):
        return {1: [comment]}

    deps, export_sink = _build_deps(
        tmp_path,
        parse_pptx=lambda *_args, **_kwargs: _make_slides(1),
        fetch_comments=fetch_comments,
        get_comments_by_slide=get_comments_by_slide,
    )

    service = ExtractionService(deps)
    ok = service.run_parse_presentation(
        str(deck),
        use_ai=True,
        use_google_api=True,
        google_slides_id="explicit-id",
        generate_stats=False,
        ai_workers=1,
        checkpoint_every=1,
    )

    assert ok is True
    assert captured["presentation_id"] == "explicit-id"
    assert export_sink["questions"][0]["comments"] == [{"author": "Reviewer", "content": "Important clue"}]
