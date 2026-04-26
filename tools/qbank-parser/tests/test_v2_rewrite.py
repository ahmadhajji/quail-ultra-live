"""Tests for Stage 3 USMLE rewrite adapter and orchestration."""

from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from app.v2_pipeline import (
    V2RunOptions,
    V2RunStats,
    _stage3_cache_key,
    run_v2_pipeline,
    stage3_rewrite,
)
from domain.models import DetectedQuestion, RewrittenQuestion, SlideContent
from providers.v2.openai_rewrite import (
    REWRITE_PROMPT_VERSION,
    OpenAIRewriteAdapter,
    RewriteResult,
    RewriteUsage,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _detected_question() -> DetectedQuestion:
    return DetectedQuestion(
        deck_id="deck-test",
        slide_number=3,
        question_index=1,
        stem_text="A 5-year-old presents with cough.",
        choices={"A": "Asthma", "B": "URI", "C": "Pneumonia", "D": "GERD"},
        correct_answer="A",
        explanation_hint="Wheezing on exam.",
        speaker_notes="Asthma is the answer.",
        comments=[{"author": "Dr. X", "content": "Definitely asthma."}],
        highlighted_texts=["Asthma"],
        confidence=85,
        status="ok",
        detect_model="gpt-5.4-mini",
    )


def _stub_rewrite_response(payload: dict, *, prompt_tokens: int = 200, completion_tokens: int = 150):
    return SimpleNamespace(
        output_text=json.dumps(payload),
        usage=SimpleNamespace(
            input_tokens=prompt_tokens,
            output_tokens=completion_tokens,
            total_tokens=prompt_tokens + completion_tokens,
        ),
    )


def _good_rewrite_payload() -> dict:
    return {
        "question_stem": "A 5-year-old boy presents with episodic wheezing and nighttime cough.",
        "question": "What is the most likely diagnosis?",
        "choices": {
            "A": "Asthma",
            "B": "Viral upper respiratory infection",
            "C": "Bacterial pneumonia",
            "D": "Gastroesophageal reflux disease",
        },
        "correct_answer": "A",
        "correct_answer_explanation": (
            "The episodic wheezing and nighttime cough strongly suggest reactive airway disease."
        ),
        "incorrect_explanations": {
            "B": "URI rarely causes nighttime wheezing.",
            "C": "Bacterial pneumonia presents with focal findings and fever.",
            "D": "GERD does not produce expiratory wheezing as the primary symptom.",
        },
        "educational_objective": "Recognize the clinical features of pediatric asthma.",
        "tags": {"rotation": "Pediatrics", "topic": "Respiratory"},
    }


# ---------------------------------------------------------------------------
# Adapter unit tests
# ---------------------------------------------------------------------------


def test_rewrite_happy_path():
    detected = _detected_question()
    client = MagicMock()
    client.responses.create.return_value = _stub_rewrite_response(_good_rewrite_payload())
    adapter = OpenAIRewriteAdapter(api_key="sk-test", client=client)
    result = adapter.rewrite(detected, "Pediatrics")
    assert result.error == ""
    assert result.question is not None
    q = result.question
    assert q.is_complete()
    assert q.rotation == "Pediatrics"
    assert q.topic == "Respiratory"
    assert q.correct_answer == "A"
    assert q.incorrect_explanations
    assert q.rewrite_prompt_version == REWRITE_PROMPT_VERSION
    assert result.usage.prompt_tokens == 200
    assert result.usage.completion_tokens == 150


def test_rewrite_validation_gate_retries_on_missing_edu_objective(monkeypatch):
    """Empty educational_objective should trigger a single retry."""
    monkeypatch.setattr("providers.v2.openai_rewrite.INITIAL_BACKOFF_SECONDS", 0.0)
    detected = _detected_question()
    bad = _good_rewrite_payload()
    bad["educational_objective"] = ""
    client = MagicMock()
    client.responses.create.side_effect = [
        _stub_rewrite_response(bad),
        _stub_rewrite_response(_good_rewrite_payload()),
    ]
    adapter = OpenAIRewriteAdapter(api_key="sk-test", client=client)
    result = adapter.rewrite(detected, "Pediatrics")
    assert result.error == ""
    assert result.question is not None
    assert result.question.educational_objective != ""
    assert client.responses.create.call_count == 2
    assert result.usage.prompt_tokens == 400


def test_rewrite_gives_up_after_validation_retry_failure(monkeypatch):
    monkeypatch.setattr("providers.v2.openai_rewrite.INITIAL_BACKOFF_SECONDS", 0.0)
    detected = _detected_question()
    bad = _good_rewrite_payload()
    bad["educational_objective"] = ""
    client = MagicMock()
    client.responses.create.return_value = _stub_rewrite_response(bad)
    adapter = OpenAIRewriteAdapter(api_key="sk-test", client=client)
    result = adapter.rewrite(detected, "Pediatrics")
    assert result.question is None
    assert "validation" in result.error or "incomplete" in result.error
    assert client.responses.create.call_count == 2


def test_rewrite_retries_on_network_failure(monkeypatch):
    monkeypatch.setattr("providers.v2.openai_rewrite.INITIAL_BACKOFF_SECONDS", 0.0)
    detected = _detected_question()
    client = MagicMock()
    client.responses.create.side_effect = [
        RuntimeError("transient network error"),
        _stub_rewrite_response(_good_rewrite_payload()),
    ]
    adapter = OpenAIRewriteAdapter(api_key="sk-test", client=client)
    result = adapter.rewrite(detected, "Pediatrics")
    assert result.error == ""
    assert result.question is not None
    assert client.responses.create.call_count == 2


def test_rewrite_invalid_rotation_raises():
    detected = _detected_question()
    client = MagicMock()
    adapter = OpenAIRewriteAdapter(api_key="sk-test", client=client)
    with pytest.raises(ValueError):
        adapter.rewrite(detected, "MadeUpSpecialty")


def test_rewrite_requires_api_key():
    with pytest.raises(ValueError):
        OpenAIRewriteAdapter(api_key="")


def test_rewrite_payload_includes_speaker_notes_and_comments_in_prompt():
    detected = _detected_question()
    client = MagicMock()
    client.responses.create.return_value = _stub_rewrite_response(_good_rewrite_payload())
    adapter = OpenAIRewriteAdapter(api_key="sk-test", client=client)
    adapter.rewrite(detected, "Pediatrics")
    call_args = client.responses.create.call_args
    user_text_block = call_args.kwargs["input"][1]["content"][0]["text"]
    assert "SPEAKER NOTES" in user_text_block
    assert "DECK COMMENTS" in user_text_block
    assert "HIGHLIGHTED TEXT" in user_text_block
    assert "Pediatrics" in user_text_block


# ---------------------------------------------------------------------------
# Stage 3 orchestration tests
# ---------------------------------------------------------------------------


class _StubRewriteAdapter:
    """Drop-in adapter that returns a complete RewrittenQuestion per call."""

    def __init__(self, model_name: str = "stub-rewrite-model"):
        self.model_name = model_name
        self.calls = 0

    def rewrite(self, detected: DetectedQuestion, rotation: str) -> RewriteResult:
        self.calls += 1
        question = RewrittenQuestion(
            deck_id=detected.deck_id,
            slide_number=detected.slide_number,
            question_index=detected.question_index,
            question_id=detected.question_id,
            stem=f"Polished stem for {detected.question_id}",
            choices={"A": "alpha", "B": "beta", "C": "gamma", "D": "delta"},
            correct_answer="A",
            correct_explanation="A is correct because alpha.",
            incorrect_explanations={
                "B": "B is wrong because beta.",
                "C": "C is wrong because gamma.",
                "D": "D is wrong because delta.",
            },
            educational_objective="Understand alpha vs beta.",
            rotation=rotation,
            topic="Test Topic",
            rewrite_model=self.model_name,
            rewrite_prompt_version=REWRITE_PROMPT_VERSION,
        )
        return RewriteResult(
            question_id=detected.question_id,
            question=question,
            usage=RewriteUsage(prompt_tokens=200, completion_tokens=150),
            attempts=1,
        )


def test_stage3_rewrites_and_writes_outputs(tmp_path):
    out = tmp_path / "out"
    out.mkdir()
    detected = [
        _detected_question(),
        DetectedQuestion(
            deck_id="deck-test",
            slide_number=4,
            question_index=1,
            stem_text="Q4 stem",
            choices={"A": "x", "B": "y", "C": "z", "D": "w"},
            correct_answer="B",
            confidence=90,
            status="ok",
        ),
    ]
    stub = _StubRewriteAdapter()
    opts = V2RunOptions(
        pptx_path="x",
        output_dir=out,
        api_key="sk-test",
        rotation="Pediatrics",
        rewrite_adapter=stub,
    )
    stats = V2RunStats()
    rewritten, errors = stage3_rewrite(detected, opts, stats)
    assert errors == {}
    assert len(rewritten) == 2
    assert rewritten[0].slide_number == 3
    assert rewritten[1].slide_number == 4
    assert all(q.is_complete() for q in rewritten)
    assert stats.rewrite_calls == 2
    assert stats.rewrite_prompt_tokens == 400
    assert (out / "rewritten_questions.json").exists()
    assert (out / "v2_stage3_cache.json").exists()
    payload = json.loads((out / "rewritten_questions.json").read_text())
    assert payload[0]["educational_objective"] != ""


def test_stage3_cache_hit_skips_api(tmp_path):
    out = tmp_path / "out"
    out.mkdir()
    detected = [_detected_question()]

    stub1 = _StubRewriteAdapter()
    stage3_rewrite(
        detected,
        V2RunOptions(
            pptx_path="x",
            output_dir=out,
            api_key="sk-test",
            rotation="Pediatrics",
            rewrite_adapter=stub1,
        ),
        V2RunStats(),
    )
    assert stub1.calls == 1

    stub2 = _StubRewriteAdapter()
    stats = V2RunStats()
    stage3_rewrite(
        detected,
        V2RunOptions(
            pptx_path="x",
            output_dir=out,
            api_key="sk-test",
            rotation="Pediatrics",
            rewrite_adapter=stub2,
        ),
        stats,
    )
    assert stub2.calls == 0
    assert stats.rewrite_cache_hits == 1
    assert stats.rewrite_calls == 0


def test_stage3_cache_invalidates_on_rotation_change(tmp_path):
    """A different rotation must produce a different cache key."""
    out = tmp_path / "out"
    out.mkdir()
    detected = [_detected_question()]

    stub_a = _StubRewriteAdapter()
    stage3_rewrite(
        detected,
        V2RunOptions(
            pptx_path="x",
            output_dir=out,
            api_key="sk-test",
            rotation="Pediatrics",
            rewrite_adapter=stub_a,
        ),
        V2RunStats(),
    )
    stub_b = _StubRewriteAdapter()
    stats = V2RunStats()
    stage3_rewrite(
        detected,
        V2RunOptions(
            pptx_path="x",
            output_dir=out,
            api_key="sk-test",
            rotation="Internal Medicine",
            rewrite_adapter=stub_b,
        ),
        stats,
    )
    assert stub_b.calls == 1


def test_stage3_records_failures(tmp_path):
    out = tmp_path / "out"
    out.mkdir()

    class _FailingAdapter:
        model_name = "failing"

        def rewrite(self, detected, rotation):
            return RewriteResult(
                question_id=detected.question_id,
                question=None,
                usage=RewriteUsage(prompt_tokens=100, completion_tokens=20),
                error="rate limited",
            )

    stats = V2RunStats()
    rewritten, errors = stage3_rewrite(
        [_detected_question()],
        V2RunOptions(
            pptx_path="x",
            output_dir=out,
            api_key="sk-test",
            rotation="Pediatrics",
            rewrite_adapter=_FailingAdapter(),
        ),
        stats,
    )
    assert rewritten == []
    assert "3" in errors  # question_id from slide 3
    assert errors["3"] == "rate limited"
    assert stats.rewrite_failures == 1


def test_stage3_requires_rotation(tmp_path):
    out = tmp_path / "out"
    out.mkdir()
    opts = V2RunOptions(pptx_path="x", output_dir=out, api_key="sk-test")
    with pytest.raises(ValueError):
        stage3_rewrite([_detected_question()], opts, V2RunStats())


def test_stage3_cache_key_changes_on_content():
    a = _detected_question()
    b = _detected_question()
    b.stem_text = "different stem"
    assert _stage3_cache_key(a, "m", "v", "Pediatrics") != _stage3_cache_key(
        b, "m", "v", "Pediatrics"
    )


# ---------------------------------------------------------------------------
# End-to-end smoke (Stages 1 + 2 + 3) with stubs
# ---------------------------------------------------------------------------


class _StubDetectAdapter:
    model_name = "stub-detect"

    def detect(self, slide):
        from providers.v2.openai_detect import (
            DETECT_PROMPT_VERSION,
            DetectionResult,
            DetectionUsage,
        )

        question = DetectedQuestion(
            deck_id=slide.deck_id,
            slide_number=slide.slide_number,
            question_index=1,
            stem_text=f"Stem from slide {slide.slide_number}",
            choices={"A": "x", "B": "y", "C": "z", "D": "w"},
            correct_answer="A",
            confidence=85,
            status="ok",
            detect_model=self.model_name,
            detect_prompt_version=DETECT_PROMPT_VERSION,
        )
        return DetectionResult(
            slide_number=slide.slide_number,
            questions=[question],
            usage=DetectionUsage(prompt_tokens=10, completion_tokens=5),
        )


def _stub_pack_export_fn():
    """Drop-in for export_native_quail_qbank that just records the call."""
    calls = []

    def _fn(**kwargs):
        calls.append(kwargs)
        return SimpleNamespace(
            output_dir=str(kwargs.get("output_dir")),
            qa_report_markdown=None,
        )

    _fn.calls = calls  # type: ignore[attr-defined]
    return _fn


def test_run_v2_pipeline_end_to_end_smoke(tmp_path):
    pptx = tmp_path / "deck.pptx"
    pptx.write_bytes(b"fake")
    out = tmp_path / "run"
    slide_contents = [
        SlideContent(slide_number=1, texts=["Q?"], speaker_notes="n", images=[]),
        SlideContent(slide_number=2, texts=["Q2?"], speaker_notes="n", images=[]),
    ]
    screenshots = [str(tmp_path / "shot1.png"), str(tmp_path / "shot2.png")]
    export_fn = _stub_pack_export_fn()

    opts = V2RunOptions(
        pptx_path=str(pptx),
        output_dir=out,
        rotation="Pediatrics",
        pack_id="test-peds",
        title="Peds Smoke",
        api_key="sk-test",
        parse_pptx_fn=lambda *a, **kw: slide_contents,
        pptx_to_images_fn=lambda *a, **kw: screenshots,
        detect_adapter=_StubDetectAdapter(),
        rewrite_adapter=_StubRewriteAdapter(),
    )
    result = run_v2_pipeline(opts, export_fn=export_fn)
    assert len(result.raw_slides) == 2
    assert len(result.detected_questions) == 2
    assert len(result.rewritten_questions) == 2
    assert all(q.is_complete() for q in result.rewritten_questions)
    assert result.stage2_errors == {}
    assert result.stage3_errors == {}
    assert result.stats.detect_calls == 2
    assert result.stats.rewrite_calls == 2
    assert (out / "rewritten_questions.json").exists()
    assert result.pack_summary is not None
    assert (out / "v2_export_input.json").exists()
    payload = json.loads((out / "v2_export_input.json").read_text())
    assert len(payload["questions"]) == 2
    assert payload["questions"][0]["tags"]["rotation"] == "Pediatrics"
    assert export_fn.calls[0]["pack_id"] == "test-peds"
    assert export_fn.calls[0]["title"] == "Peds Smoke"
    stats_blob = json.loads((out / "v2_run_stats.json").read_text())
    assert stats_blob["rewrite_calls"] == 2


def test_stage4_real_exporter_produces_native_pack(tmp_path):
    """Integration test: invoke the real export_native_quail_qbank and verify pack files."""
    from app.v2_pipeline import stage4_export

    out = tmp_path / "out"
    out.mkdir()
    rewritten = [
        RewrittenQuestion(
            deck_id="deck-int",
            slide_number=1,
            question_index=1,
            stem=(
                "A 5-year-old boy presents with episodic wheezing and nighttime cough. "
                "He has a history of eczema."
            ),
            choices={
                "A": "Asthma",
                "B": "Viral upper respiratory infection",
                "C": "Bacterial pneumonia",
                "D": "Gastroesophageal reflux disease",
            },
            correct_answer="A",
            correct_explanation="The episodic wheezing strongly suggests asthma.",
            incorrect_explanations={
                "B": "URI rarely causes nighttime wheezing.",
                "C": "Bacterial pneumonia presents with focal findings and fever.",
                "D": "GERD does not cause expiratory wheezing.",
            },
            educational_objective="Recognize the clinical features of pediatric asthma.",
            rotation="Pediatrics",
            topic="Respiratory",
        )
    ]
    summary = stage4_export(
        rewritten,
        V2RunOptions(
            pptx_path="x",
            output_dir=out,
            rotation="Pediatrics",
            pack_id="int-test",
            title="Integration Test",
            api_key="sk-test",
        ),
    )
    pack_dir = out / "packs" / "int-test"
    assert pack_dir.exists()
    manifest_path = pack_dir / "quail-ultra-pack.json"
    assert manifest_path.exists()
    manifest = json.loads(manifest_path.read_text())
    assert manifest["packId"] == "int-test"
    assert manifest["title"] == "Integration Test"
    assert len(manifest["questionIndex"]) == 1
    # Validate the per-question file actually exists and has the expected fields
    question_relpath = manifest["questionIndex"][0]["path"]
    question_file = pack_dir / question_relpath
    assert question_file.exists()
    qdata = json.loads(question_file.read_text())
    # Educational objective is a list of content blocks
    edu_blocks = qdata["explanation"]["educationalObjective"]
    assert isinstance(edu_blocks, list) and edu_blocks
    assert any(block.get("text", "").strip() for block in edu_blocks)
    # Tags carried through correctly
    assert qdata["tags"]["rotation"] == "Pediatrics"
    assert qdata["tags"]["topic"] == "Respiratory"
    # Correct choice id should be one of the choice IDs (post-randomization)
    correct_id = qdata["answerKey"]["correctChoiceId"]
    choice_ids = {choice["id"] for choice in qdata["choices"]}
    assert correct_id in choice_ids
    # Every non-correct choice has an explanation in `explanation.incorrect`
    incorrect_map = qdata["explanation"]["incorrect"]
    non_correct_ids = choice_ids - {correct_id}
    for choice_id in non_correct_ids:
        assert choice_id in incorrect_map
        blocks = incorrect_map[choice_id]
        assert isinstance(blocks, list) and blocks
        assert any(block.get("text", "").strip() for block in blocks)
    # Correct explanation is a non-empty list of blocks
    correct_blocks = qdata["explanation"]["correct"]
    assert isinstance(correct_blocks, list) and correct_blocks
    assert summary is not None


def test_stage4_translates_rewritten_to_legacy_dict(tmp_path):
    from app.v2_pipeline import _rewritten_to_legacy_dict, stage4_export

    out = tmp_path / "out"
    out.mkdir()
    rewritten = [
        RewrittenQuestion(
            deck_id="d",
            slide_number=1,
            question_index=1,
            stem="Polished stem",
            choices={"A": "alpha", "B": "beta", "C": "gamma", "D": "delta"},
            correct_answer="A",
            correct_explanation="A is correct",
            incorrect_explanations={"B": "B wrong", "C": "C wrong", "D": "D wrong"},
            educational_objective="Know alpha",
            rotation="Pediatrics",
            topic="Test",
        )
    ]
    legacy = _rewritten_to_legacy_dict(rewritten[0])
    assert legacy["question_id"] == "1"
    assert legacy["original_slide_number"] == 1
    assert legacy["question_stem"] == "Polished stem"
    assert legacy["correct_answer"] == "A"
    assert legacy["tags"]["rotation"] == "Pediatrics"
    assert legacy["tags"]["topic"] == "Test"
    assert legacy["correct_answer_explanation"] == "A is correct"
    assert legacy["educational_objective"] == "Know alpha"

    export_fn = _stub_pack_export_fn()
    summary = stage4_export(
        rewritten,
        V2RunOptions(
            pptx_path="x",
            output_dir=out,
            rotation="Pediatrics",
            pack_id="test-pack",
            title="Test Pack",
            api_key="sk-test",
        ),
        export_fn=export_fn,
    )
    assert summary is not None
    assert export_fn.calls[0]["pack_id"] == "test-pack"
    assert export_fn.calls[0]["title"] == "Test Pack"
    assert (out / "v2_export_input.json").exists()
