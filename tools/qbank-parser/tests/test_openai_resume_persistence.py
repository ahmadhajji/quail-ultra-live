from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

from app.extraction_service import ExtractionService, ExtractionServiceDeps
from app import workflows
from domain.models import ExtractedQuestion, USMLEQuestion


class _InterruptingProcessor:
    def __init__(self, *_args, **_kwargs):
        pass

    def process_slide(self, slide_number, **_kwargs):
        if slide_number == 2:
            raise KeyboardInterrupt()
        return [
            ExtractedQuestion(
                slide_number=slide_number,
                is_valid_question=True,
                question_stem=f"Question {slide_number}",
                choices={"A": "One", "B": "Two", "C": "Three"},
                correct_answer="A",
                correct_answer_text="One",
                confidence=90,
            )
        ]


def _slides(count: int):
    return [
        SimpleNamespace(
            slide_number=index,
            texts=[f"Slide {index}"],
            speaker_notes="",
            highlighted_texts=[],
            potential_correct_answer="",
            images=[],
        )
        for index in range(1, count + 1)
    ]


def test_openai_extraction_interrupt_writes_partial_and_run_state(tmp_path):
    deck = tmp_path / "deck.pptx"
    deck.write_bytes(b"deck")
    output_dir = tmp_path / "output"
    output_dir.mkdir(parents=True, exist_ok=True)

    def export_to_json(questions, output_path, *_args, **_kwargs):
        payload = {
            "total_slides": len({q.slide_number for q in questions}),
            "valid_questions": sum(1 for q in questions if q.is_valid_question),
            "questions": [q.to_dict() for q in questions],
        }
        output_path.write_text(json.dumps(payload), encoding="utf-8")
        return output_path

    deps = ExtractionServiceDeps(
        console=None,
        print_banner=lambda: None,
        parse_pptx=lambda *_args, **_kwargs: _slides(2),
        fetch_comments=lambda _id: [],
        get_comments_by_slide=lambda _comments: {},
        openai_processor_cls=_InterruptingProcessor,
        export_to_json=export_to_json,
        export_to_csv=lambda _questions, output_path, *_args, **_kwargs: output_path,
        save_progress=workflows.save_progress,
        is_progress_compatible=workflows.is_progress_compatible,
        get_speed_profile_config=workflows.get_speed_profile_config,
        question_sort_key=workflows.question_sort_key,
        output_dir=output_dir,
        openai_api_key="test-key",
        openai_extraction_model="gpt-4.1-mini",
        google_slides_id="",
        stats_available=False,
        run_repository=workflows.RUN_REPOSITORY,
    )

    service = ExtractionService(deps)
    ok = service.run_parse_presentation(str(deck), use_ai=True, ai_workers=1, checkpoint_every=1)

    assert ok is False
    partial_path = output_dir / "extracted_questions.partial.json"
    run_state_path = output_dir / "run_state.json"
    progress_path = output_dir / "extraction_progress.json"
    assert partial_path.exists()
    assert progress_path.exists()
    partial = json.loads(partial_path.read_text(encoding="utf-8"))
    assert partial["questions"][0]["slide_number"] == 1
    run_state = json.loads(run_state_path.read_text(encoding="utf-8"))
    assert run_state["status"] == "interrupted"
    assert run_state["provider"] == "openai"


def test_openai_formatter_failure_writes_partial_and_run_state(monkeypatch, tmp_path):
    monkeypatch.setattr(workflows, "OUTPUT_DIR", tmp_path)
    monkeypatch.setattr(workflows, "console", None)

    class FakeFormatter:
        def __init__(self, *args, **kwargs):
            self.model_name = kwargs.get("model_name", "gpt-5.4")
            self.provider = kwargs.get("provider", "openai")

        def _prepare_cache_state(self, **_kwargs):
            return {"source_fingerprint": "fingerprint"}, {}, 0, _kwargs["valid_questions"]

        def _source_fingerprint(self, _questions):
            return "fingerprint"

        def format_batch(self, questions, checkpoint_callback=None, **_kwargs):
            results_by_id = {}
            first = questions[0]
            qid = first.question_id
            results_by_id[qid] = USMLEQuestion(
                original_slide_number=first.slide_number,
                question_id=qid,
                question_stem="stem",
                question="question",
                choices={"A": "A", "B": "B", "C": "C", "D": "D"},
                correct_answer="A",
                correct_answer_explanation="because",
                incorrect_explanations={"B": "no", "C": "no", "D": "no"},
                educational_objective="obj",
                tags={"rotation": "Internal Medicine", "topic": "Cardiology"},
            )
            if checkpoint_callback:
                checkpoint_callback(qid, results_by_id, questions, {"source_fingerprint": "fingerprint"})
            raise RuntimeError("boom")

    monkeypatch.setattr(workflows, "USMLEFormatter", FakeFormatter)

    questions = [
        ExtractedQuestion(
            slide_number=1,
            question_id="q1",
            question_stem="Q1",
            choices={"A": "A", "B": "B", "C": "C"},
            correct_answer="A",
            correct_answer_text="A",
        ),
        ExtractedQuestion(
            slide_number=2,
            question_id="q2",
            question_stem="Q2",
            choices={"A": "A", "B": "B", "C": "C"},
            correct_answer="A",
            correct_answer_text="A",
        ),
    ]

    with pytest.raises(RuntimeError, match="boom"):
        workflows.format_questions_to_usmle_outputs(
            questions,
            source_file=tmp_path / "extracted_questions.json",
            formatter_provider="openai",
        )

    partial_path = tmp_path / "usmle_formatted_questions.partial.json"
    run_state_path = tmp_path / "run_state.json"
    assert partial_path.exists()
    run_state = json.loads(run_state_path.read_text(encoding="utf-8"))
    assert run_state["status"] == "failed"
    assert run_state["completed_items"] == 1
    assert run_state["search_enabled"] is False
