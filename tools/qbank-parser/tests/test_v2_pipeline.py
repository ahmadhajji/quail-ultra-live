"""Tests for the v2 pipeline orchestrator and Stage 2 detect adapter."""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from app.v2_pipeline import (
    V2RunOptions,
    V2RunStats,
    _coerce_comments,
    _filter_comments_by_slide,
    _stage2_cache_key,
    run_v2_pipeline,
    run_v2_stages_1_and_2,
    stage1_raw_extract,
    stage2_detect,
)
from domain.models import DetectedQuestion, RawSlide, SlideContent
from providers.v2.openai_detect import (
    DETECT_PROMPT_VERSION,
    DetectionResult,
    DetectionUsage,
    OpenAIDetectAdapter,
    _build_questions,
    _resolve_image_refs,
)


# ---------------------------------------------------------------------------
# Detect adapter unit tests
# ---------------------------------------------------------------------------


def _png_bytes() -> bytes:
    # 1x1 transparent PNG
    return (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
        b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xfa\xff"
        b"\xff\xff?\x00\x05\xfe\x02\xfe\xa0\x16\xe0w\x00\x00\x00\x00IEND\xaeB`\x82"
    )


def _make_raw_slide(tmp_path: Path) -> RawSlide:
    screenshot = tmp_path / "slide1.png"
    screenshot.write_bytes(_png_bytes())
    img1 = tmp_path / "img1.png"
    img1.write_bytes(_png_bytes())
    return RawSlide(
        slide_number=1,
        deck_id="deck-test",
        text_blocks=["What is the most likely diagnosis?"],
        speaker_notes="Asthma should be on the differential.",
        highlighted_texts=["Asthma"],
        potential_correct_answer="Asthma",
        image_paths=[str(img1)],
        slide_screenshot_path=str(screenshot),
        comments=[{"author": "Dr. X", "content": "Why not GERD?"}],
    )


def _stub_response(json_payload: dict, *, prompt_tokens: int = 100, completion_tokens: int = 50):
    """Build a SimpleNamespace mimicking the openai Responses API result."""
    return SimpleNamespace(
        output_text=json.dumps(json_payload),
        usage=SimpleNamespace(
            input_tokens=prompt_tokens,
            output_tokens=completion_tokens,
            total_tokens=prompt_tokens + completion_tokens,
        ),
    )


def test_detect_happy_path(tmp_path):
    slide = _make_raw_slide(tmp_path)
    client = MagicMock()
    client.responses.create.return_value = _stub_response(
        {
            "questions": [
                {
                    "question_index": 1,
                    "stem_text": "What is the most likely diagnosis?",
                    "choices": {"A": "Asthma", "B": "GERD", "C": "URI", "D": "Pneumonia"},
                    "correct_answer": "A",
                    "explanation_hint": "Wheezing on exam suggests asthma.",
                    "stem_image_numbers": [1],
                    "explanation_image_numbers": [],
                    "confidence": 92,
                    "warnings": [],
                }
            ],
            "no_question_reason": "",
        }
    )
    adapter = OpenAIDetectAdapter(api_key="sk-test", client=client)
    result = adapter.detect(slide)
    assert result.error == ""
    assert len(result.questions) == 1
    q = result.questions[0]
    assert q.slide_number == 1
    assert q.question_index == 1
    assert q.correct_answer == "A"
    assert q.confidence == 92
    assert q.status == "ok"
    assert q.detect_prompt_version == DETECT_PROMPT_VERSION
    assert q.stem_image_paths == slide.image_paths  # 1-based ref [1] -> first image
    assert result.usage.prompt_tokens == 100
    assert result.usage.completion_tokens == 50


def test_detect_no_questions_slide(tmp_path):
    slide = _make_raw_slide(tmp_path)
    client = MagicMock()
    client.responses.create.return_value = _stub_response({"questions": [], "no_question_reason": "Title slide"})
    adapter = OpenAIDetectAdapter(api_key="sk-test", client=client)
    result = adapter.detect(slide)
    assert result.error == ""
    assert result.no_question_reason == "Title slide"
    assert result.questions == []


def test_detect_low_confidence_marks_needs_review(tmp_path):
    slide = _make_raw_slide(tmp_path)
    client = MagicMock()
    client.responses.create.return_value = _stub_response(
        {
            "questions": [
                {
                    "question_index": 1,
                    "stem_text": "Maybe a question?",
                    "choices": {"A": "x", "B": "y", "C": "z", "D": "w"},
                    "correct_answer": "A",
                    "explanation_hint": "",
                    "stem_image_numbers": [],
                    "explanation_image_numbers": [],
                    "confidence": 40,
                    "warnings": ["unclear stem"],
                }
            ],
            "no_question_reason": "",
        }
    )
    adapter = OpenAIDetectAdapter(api_key="sk-test", client=client)
    result = adapter.detect(slide)
    assert result.questions[0].status == "needs_review"
    assert "unclear stem" in result.questions[0].detection_warnings
    assert any("Low detection confidence" in warning for warning in result.questions[0].detection_warnings)


def test_detect_invalid_json_returns_error(tmp_path, monkeypatch):
    slide = _make_raw_slide(tmp_path)
    monkeypatch.setattr("providers.v2.openai_detect.INITIAL_BACKOFF_SECONDS", 0.0)
    client = MagicMock()
    client.responses.create.return_value = SimpleNamespace(
        output_text="not json at all",
        usage=SimpleNamespace(input_tokens=10, output_tokens=5, total_tokens=15),
    )
    adapter = OpenAIDetectAdapter(api_key="sk-test", client=client)
    result = adapter.detect(slide)
    assert "json parse" in result.error
    assert result.questions == []


def test_detect_retries_on_exception(tmp_path, monkeypatch):
    slide = _make_raw_slide(tmp_path)
    monkeypatch.setattr("providers.v2.openai_detect.INITIAL_BACKOFF_SECONDS", 0.0)
    client = MagicMock()
    client.responses.create.side_effect = [
        RuntimeError("transient network error"),
        _stub_response({"questions": [], "no_question_reason": "Empty"}),
    ]
    adapter = OpenAIDetectAdapter(api_key="sk-test", client=client)
    result = adapter.detect(slide)
    assert result.error == ""
    assert result.no_question_reason == "Empty"
    assert client.responses.create.call_count == 2


def test_detect_gives_up_after_max_retries(tmp_path, monkeypatch):
    slide = _make_raw_slide(tmp_path)
    monkeypatch.setattr("providers.v2.openai_detect.INITIAL_BACKOFF_SECONDS", 0.0)
    monkeypatch.setattr("providers.v2.openai_detect.MAX_RETRIES", 2)
    client = MagicMock()
    client.responses.create.side_effect = RuntimeError("persistent failure")
    adapter = OpenAIDetectAdapter(api_key="sk-test", client=client)
    result = adapter.detect(slide)
    assert "persistent failure" in result.error
    assert result.questions == []


def test_resolve_image_refs_handles_out_of_bounds(tmp_path):
    slide = _make_raw_slide(tmp_path)
    assert _resolve_image_refs(slide, [1]) == slide.image_paths
    assert _resolve_image_refs(slide, [99]) == []
    assert _resolve_image_refs(slide, [0]) == []
    assert _resolve_image_refs(slide, ["bogus"]) == []
    assert _resolve_image_refs(slide, []) == []


def test_build_questions_filters_image_refs(tmp_path):
    slide = _make_raw_slide(tmp_path)
    payload = {
        "questions": [
            {
                "question_index": 2,
                "stem_text": "stem",
                "choices": {"A": "x", "B": "y"},
                "correct_answer": "a",  # lowercase
                "explanation_hint": "h",
                "stem_image_numbers": [1, 99],  # 99 is out of bounds
                "explanation_image_numbers": [],
                "confidence": 80,
                "warnings": [],
            }
        ]
    }
    questions = _build_questions(slide, payload, model_name="test-model")
    assert len(questions) == 1
    q = questions[0]
    assert q.correct_answer == "A"  # uppercased
    assert q.stem_image_paths == slide.image_paths  # 99 dropped
    assert q.detect_model == "test-model"


def test_build_questions_marks_structural_risks_needs_review(tmp_path):
    slide = _make_raw_slide(tmp_path)
    payload = {
        "questions": [
            {
                "question_index": 1,
                "stem_text": "",
                "choices": [{"letter": "A)", "text": "Only one choice"}],
                "correct_answer": "C",
                "explanation_hint": "",
                "stem_image_numbers": [],
                "explanation_image_numbers": [],
                "confidence": 90,
                "warnings": [],
            }
        ]
    }

    questions = _build_questions(slide, payload, model_name="test-model")

    assert questions[0].status == "needs_review"
    assert questions[0].choices == {"A": "Only one choice"}
    assert "Missing detected question stem." in questions[0].detection_warnings
    assert "Fewer than four detected answer choices." in questions[0].detection_warnings
    assert "Detected correct answer 'C' is not present in choices." in questions[0].detection_warnings


def test_detect_payload_labels_multimodal_images(tmp_path):
    slide = _make_raw_slide(tmp_path)
    adapter = OpenAIDetectAdapter(api_key="sk-test", client=MagicMock())

    payload = adapter._build_user_payload(slide)
    labels = [item["text"] for item in payload if item.get("type") == "input_text"]

    assert "SLIDE SCREENSHOT" in labels
    assert "EXTRACTED IMAGE 1" in labels


def test_adapter_requires_api_key():
    with pytest.raises(ValueError):
        OpenAIDetectAdapter(api_key="")


# ---------------------------------------------------------------------------
# Stage 1 — Raw extraction
# ---------------------------------------------------------------------------


def _fake_parse_pptx_factory(slide_contents: list[SlideContent]):
    def _fake(pptx_path, output_dir):
        return slide_contents

    return _fake


def _fake_pptx_to_images_factory(paths: list[str]):
    def _fake(pptx_path, output_dir, dpi=150):
        return paths

    return _fake


def test_stage1_writes_raw_slides_json_and_metadata(tmp_path):
    pptx = tmp_path / "deck.pptx"
    pptx.write_bytes(b"fake")
    out = tmp_path / "out"

    slide_contents = [
        SlideContent(
            slide_number=1,
            texts=["Q?"],
            speaker_notes="notes",
            highlighted_texts=["hl"],
            potential_correct_answer="hl",
            images=["/tmp/img.png"],
        ),
        SlideContent(slide_number=2, texts=["title slide"]),
    ]
    screenshots = [str(tmp_path / "s1.png"), str(tmp_path / "s2.png")]

    opts = V2RunOptions(
        pptx_path=str(pptx),
        output_dir=out,
        rotation="Pediatrics",
        api_key="sk-test",
        parse_pptx_fn=_fake_parse_pptx_factory(slide_contents),
        pptx_to_images_fn=_fake_pptx_to_images_factory(screenshots),
    )

    raw_slides, meta = stage1_raw_extract(opts)
    assert len(raw_slides) == 2
    assert raw_slides[0].slide_number == 1
    assert raw_slides[0].deck_id == "deck"
    assert raw_slides[0].slide_screenshot_path == screenshots[0]
    assert raw_slides[1].slide_screenshot_path == screenshots[1]
    assert meta["slide_count"] == 2
    assert (out / "raw_slides.json").exists()
    payload = json.loads((out / "raw_slides.json").read_text())
    assert payload[0]["slide_number"] == 1
    assert payload[0]["highlighted_texts"] == ["hl"]


def test_stage1_requires_input_source():
    opts = V2RunOptions(api_key="sk-test")
    with pytest.raises(ValueError):
        stage1_raw_extract(opts)


def test_filter_comments_by_slide_drops_unanchored_and_caps_volume():
    raw = {
        0: [{"author": "X", "content": "unanchored"}],  # drop
        1: [{"author": "X", "content": f"c{i}"} for i in range(50)],  # cap to 25
        99: [{"author": "X", "content": "out of scope"}],  # drop
    }
    filtered = _filter_comments_by_slide(raw, {1, 2, 3})
    assert 0 not in filtered
    assert 99 not in filtered
    assert len(filtered[1]) == 25


def test_coerce_comments_normalizes_and_drops_empty():
    items = [
        {"author": "A", "content": "ok"},
        {"author": "B", "content": ""},
        {"author": "C", "content": "  "},
        SimpleNamespace(author="D", content="from object"),
    ]
    result = _coerce_comments(items)
    assert len(result) == 2
    assert result[0] == {"author": "A", "content": "ok"}
    assert result[1] == {"author": "D", "content": "from object"}


# ---------------------------------------------------------------------------
# Stage 2 — Detection orchestration
# ---------------------------------------------------------------------------


class _StubDetectAdapter:
    """Drop-in for OpenAIDetectAdapter that returns canned results per slide."""

    def __init__(self, model_name: str = "stub-model"):
        self.model_name = model_name
        self.calls = 0

    def detect(self, slide: RawSlide) -> DetectionResult:
        self.calls += 1
        question = DetectedQuestion(
            deck_id=slide.deck_id,
            slide_number=slide.slide_number,
            question_index=1,
            stem_text=f"Stem from slide {slide.slide_number}",
            choices={"A": "x", "B": "y", "C": "z", "D": "w"},
            correct_answer="A",
            explanation_hint="",
            stem_image_paths=[],
            explanation_image_paths=[],
            source_slide_path=slide.slide_screenshot_path,
            speaker_notes=slide.speaker_notes,
            comments=list(slide.comments),
            highlighted_texts=list(slide.highlighted_texts),
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


def test_stage2_runs_detection_and_writes_outputs(tmp_path):
    out = tmp_path / "out"
    out.mkdir()
    slides = [
        RawSlide(slide_number=1, deck_id="d", text_blocks=["q?"], image_paths=[]),
        RawSlide(slide_number=2, deck_id="d", text_blocks=["q2?"], image_paths=[]),
    ]
    stub = _StubDetectAdapter()
    opts = V2RunOptions(
        pptx_path="dummy.pptx",
        output_dir=out,
        api_key="sk-test",
        detect_adapter=stub,
    )
    stats = V2RunStats()
    detected, errors = stage2_detect(slides, opts, stats)

    assert errors == {}
    assert len(detected) == 2
    assert detected[0].slide_number == 1
    assert detected[1].slide_number == 2
    assert stats.ai_calls == 2
    assert stats.prompt_tokens == 20
    assert (out / "detected_questions.json").exists()
    assert (out / "v2_stage2_cache.json").exists()


def test_stage2_cache_hit_skips_api(tmp_path):
    out = tmp_path / "out"
    out.mkdir()
    slide = RawSlide(slide_number=1, deck_id="d", text_blocks=["q?"], image_paths=[])

    # First run populates the cache
    stub1 = _StubDetectAdapter()
    opts1 = V2RunOptions(pptx_path="x", output_dir=out, api_key="sk-test", detect_adapter=stub1)
    stage2_detect([slide], opts1, V2RunStats())
    assert stub1.calls == 1

    # Second run with same content should hit the cache and skip the API
    stub2 = _StubDetectAdapter()
    opts2 = V2RunOptions(pptx_path="x", output_dir=out, api_key="sk-test", detect_adapter=stub2)
    stats2 = V2RunStats()
    detected, _errors = stage2_detect([slide], opts2, stats2)
    assert stub2.calls == 0
    assert stats2.cache_hits == 1
    assert stats2.ai_calls == 0
    assert len(detected) == 1


def test_stage2_cache_invalidates_on_model_change(tmp_path):
    out = tmp_path / "out"
    out.mkdir()
    slide = RawSlide(slide_number=1, deck_id="d", text_blocks=["q?"], image_paths=[])
    stub_a = _StubDetectAdapter(model_name="model-a")
    stage2_detect(
        [slide],
        V2RunOptions(pptx_path="x", output_dir=out, api_key="sk-test", detect_adapter=stub_a),
        V2RunStats(),
    )
    # Different model -> different cache key -> miss
    stub_b = _StubDetectAdapter(model_name="model-b")
    stats = V2RunStats()
    stage2_detect(
        [slide],
        V2RunOptions(pptx_path="x", output_dir=out, api_key="sk-test", detect_adapter=stub_b),
        stats,
    )
    assert stub_b.calls == 1
    assert stats.ai_calls == 1


def test_stage2_cache_disabled_always_calls(tmp_path):
    out = tmp_path / "out"
    out.mkdir()
    slide = RawSlide(slide_number=1, deck_id="d", text_blocks=["q?"], image_paths=[])
    stub = _StubDetectAdapter()
    stage2_detect(
        [slide],
        V2RunOptions(
            pptx_path="x",
            output_dir=out,
            api_key="sk-test",
            detect_adapter=stub,
            use_cache=False,
        ),
        V2RunStats(),
    )
    stage2_detect(
        [slide],
        V2RunOptions(
            pptx_path="x",
            output_dir=out,
            api_key="sk-test",
            detect_adapter=stub,
            use_cache=False,
        ),
        V2RunStats(),
    )
    assert stub.calls == 2


def test_stage2_cache_key_changes_on_content():
    s1 = RawSlide(slide_number=1, text_blocks=["a"])
    s2 = RawSlide(slide_number=1, text_blocks=["b"])
    assert _stage2_cache_key(s1, "m", "v") != _stage2_cache_key(s2, "m", "v")


def test_stage2_records_error_on_adapter_error(tmp_path):
    out = tmp_path / "out"
    out.mkdir()

    class _FailingAdapter:
        model_name = "failing"

        def detect(self, slide):
            return DetectionResult(slide_number=slide.slide_number, questions=[], error="rate limited")

    slide = RawSlide(slide_number=1, deck_id="d", text_blocks=["q"], image_paths=[])
    stats = V2RunStats()
    detected, errors = stage2_detect(
        [slide],
        V2RunOptions(
            pptx_path="x",
            output_dir=out,
            api_key="sk-test",
            detect_adapter=_FailingAdapter(),
        ),
        stats,
    )
    assert detected == []
    assert errors[1] == "rate limited"


# ---------------------------------------------------------------------------
# End-to-end smoke (Stages 1 + 2) with stubs
# ---------------------------------------------------------------------------


def test_run_v2_stages_1_and_2_smoke(tmp_path):
    pptx = tmp_path / "deck.pptx"
    pptx.write_bytes(b"fake")
    out = tmp_path / "run"
    slide_contents = [
        SlideContent(slide_number=1, texts=["Q?"], speaker_notes="n", images=[]),
    ]
    screenshots = [str(tmp_path / "shot1.png")]
    opts = V2RunOptions(
        pptx_path=str(pptx),
        output_dir=out,
        rotation="Pediatrics",
        api_key="sk-test",
        parse_pptx_fn=_fake_parse_pptx_factory(slide_contents),
        pptx_to_images_fn=_fake_pptx_to_images_factory(screenshots),
        detect_adapter=_StubDetectAdapter(),
    )

    result = run_v2_stages_1_and_2(opts)
    assert len(result.raw_slides) == 1
    assert len(result.detected_questions) == 1
    assert result.stage2_errors == {}
    assert result.stats.ai_calls == 1
    assert (out / "raw_slides.json").exists()
    assert (out / "detected_questions.json").exists()
    assert (out / "v2_run_stats.json").exists()
    stats_blob = json.loads((out / "v2_run_stats.json").read_text())
    assert stats_blob["ai_calls"] == 1
    assert "duration_seconds" in stats_blob


def test_run_v2_filters_slides_before_detection(tmp_path):
    pptx = tmp_path / "deck.pptx"
    pptx.write_bytes(b"fake")
    out = tmp_path / "run"
    slide_contents = [SlideContent(slide_number=i, texts=[f"Q{i}?"]) for i in range(1, 6)]
    screenshots = [str(tmp_path / f"shot{i}.png") for i in range(1, 6)]
    stub = _StubDetectAdapter()
    opts = V2RunOptions(
        pptx_path=str(pptx),
        output_dir=out,
        rotation="Pediatrics",
        api_key="sk-test",
        slide_range=(2, 5),
        max_slides=2,
        parse_pptx_fn=_fake_parse_pptx_factory(slide_contents),
        pptx_to_images_fn=_fake_pptx_to_images_factory(screenshots),
        detect_adapter=stub,
    )

    result = run_v2_stages_1_and_2(opts)

    assert stub.calls == 2
    assert [q.slide_number for q in result.detected_questions] == [2, 3]
    assert result.metadata["selected_slide_numbers"] == [2, 3]
    assert result.metadata["selected_slide_count"] == 2


def test_run_v2_dry_run_does_not_call_ai_or_export(tmp_path):
    pptx = tmp_path / "deck.pptx"
    pptx.write_bytes(b"fake")
    out = tmp_path / "run"
    slide_contents = [SlideContent(slide_number=1, texts=["Q?"], images=[])]
    screenshots = [str(tmp_path / "shot1.png")]

    class _ExplodingDetectAdapter:
        model_name = "explode"

        def detect(self, slide):
            raise AssertionError("detect adapter should not be called in dry-run")

    class _ExplodingRewriteAdapter:
        model_name = "explode"

        def rewrite(self, detected, rotation):
            raise AssertionError("rewrite adapter should not be called in dry-run")

    def _export_fn(**kwargs):
        raise AssertionError("export should not be called in dry-run")

    opts = V2RunOptions(
        pptx_path=str(pptx),
        output_dir=out,
        rotation="Pediatrics",
        api_key="sk-test",
        dry_run=True,
        parse_pptx_fn=_fake_parse_pptx_factory(slide_contents),
        pptx_to_images_fn=_fake_pptx_to_images_factory(screenshots),
        detect_adapter=_ExplodingDetectAdapter(),
        rewrite_adapter=_ExplodingRewriteAdapter(),
    )

    result = run_v2_pipeline(opts, export_fn=_export_fn)

    assert len(result.raw_slides) == 1
    assert result.detected_questions == []
    assert result.rewritten_questions == []
    assert result.stats.ai_calls == 0
    assert result.metadata["dry_run"] is True
