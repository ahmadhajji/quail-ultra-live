from __future__ import annotations

from domain.models import ExtractedQuestion
from export.usmle_formatter import USMLEFormatter, export_usmle_questions, USMLEQuestion


def test_formatter_uses_rotation_prompt_and_rotation_topic_tags(monkeypatch):
    captured_prompt = {"value": ""}

    response_json = """{
      "question_stem": "A 28-year-old...",
      "question": "What is the best next step?",
      "choices": {"A": "Choice A", "B": "Choice B", "C": "Choice C", "D": "Choice D"},
      "correct_answer": "D",
      "correct_answer_explanation": "Because...",
      "incorrect_explanations": {"A": "No", "B": "No", "C": "No"},
      "educational_objective": "High-yield teaching point",
      "tags": {"rotation": "Obstetrics & Gynecology", "topic": "Normal & Abnormal Labor"},
      "quality_flags": []
    }"""

    class FakeAdapter:
        def generate_content(self, prompt, **_kwargs):
            captured_prompt["value"] = prompt
            return response_json, []

    formatter = USMLEFormatter.__new__(USMLEFormatter)
    formatter.model_name = "gpt-5.2"
    formatter.provider = "openai"
    formatter.openai_formatter_adapter = FakeAdapter()
    formatter.last_request_time = 0
    formatter.min_request_interval = 0

    question = ExtractedQuestion(
        slide_number=7,
        question_stem="Source stem",
        choices={"A": "A", "B": "B", "C": "C", "D": "D"},
        correct_answer="A",
        correct_answer_text="A",
        explanation="source explanation",
        rotation="OB-GYN",
    )
    result = USMLEFormatter.format_question(formatter, question, question_id="deck-7")

    assert "ROTATION = OBSTETRICS & GYNECOLOGY" in captured_prompt["value"]
    assert result.tags == {"rotation": "OB-GYN", "topic": "Normal & Abnormal Labor"}


def test_export_usmle_questions_writes_dynamic_model(tmp_path):
    q = USMLEQuestion(original_slide_number=1, question_id="x-1", tags={"rotation": "Pediatrics", "topic": "Neonatology"})
    output = tmp_path / "out.json"
    export_usmle_questions(
        [q],
        output,
        "json",
        model_used="gpt-5.2",
        provider_used="openai",
    )
    data = output.read_text(encoding="utf-8")
    assert "gpt-5.2" in data
    assert "openai" in data


def test_formatter_drops_misaligned_incorrect_explanations_after_choice_cleanup():
    result = USMLEQuestion(
        original_slide_number=1,
        question_stem="Stem",
        question="Question",
        choices={"A": "Alpha", "B": "Bravo"},
        correct_answer="A",
        correct_answer_explanation="Correct explanation",
        incorrect_explanations={"A": "Should not be here", "B": "Distractor explanation", "Z": "Old remapped key"},
        educational_objective="Objective",
    )

    errors = USMLEFormatter._validate_formatted_question(result)

    assert errors == []
    assert result.incorrect_explanations == {"B": "Distractor explanation"}


def test_format_batch_resumes_from_cache_without_new_api_calls(tmp_path):
    formatter = USMLEFormatter.__new__(USMLEFormatter)
    formatter.model_name = "gpt-5.2"
    formatter.provider = "openai"
    formatter.target_rpm = 450
    formatter.max_inflight = 4
    formatter.last_request_time = 0
    formatter.min_request_interval = 0

    calls = {"count": 0}

    def fake_format_question(question, question_id, retries=3):
        calls["count"] += 1
        return USMLEQuestion(
            original_slide_number=question.slide_number,
            question_id=str(question_id),
            question_stem="Formatted stem",
            question="Best next step?",
            choices={"A": "A", "B": "B", "C": "C", "D": "D"},
            correct_answer="A",
            correct_answer_explanation="Because",
            incorrect_explanations={"B": "No", "C": "No", "D": "No"},
            educational_objective="Objective",
            tags={"rotation": "OB-GYN", "topic": "Labor"},
        )

    formatter.format_question = fake_format_question  # type: ignore[assignment]

    question = ExtractedQuestion(
        slide_number=12,
        question_index=1,
        question_id="deck-12",
        question_stem="Source stem",
        choices={"A": "A", "B": "B", "C": "C", "D": "D"},
        correct_answer="A",
        correct_answer_text="A",
        explanation="source explanation",
        rotation="OB-GYN",
    )

    cache_path = tmp_path / "usmle_formatter_cache.json"
    progress_path = tmp_path / "usmle_formatter_progress.json"

    first = formatter.format_batch(
        [question],
        checkpoint_every=1,
        cache_path=cache_path,
        progress_path=progress_path,
        source_label="test-input",
    )
    second = formatter.format_batch(
        [question],
        checkpoint_every=1,
        cache_path=cache_path,
        progress_path=progress_path,
        source_label="test-input",
    )

    assert len(first) == 1
    assert len(second) == 1
    assert calls["count"] == 1


def test_format_batch_cache_miss_when_input_changes(tmp_path):
    formatter = USMLEFormatter.__new__(USMLEFormatter)
    formatter.model_name = "gpt-5.2"
    formatter.provider = "openai"
    formatter.target_rpm = 450
    formatter.max_inflight = 4
    formatter.last_request_time = 0
    formatter.min_request_interval = 0

    calls = {"count": 0}

    def fake_format_question(question, question_id, retries=3):
        calls["count"] += 1
        return USMLEQuestion(
            original_slide_number=question.slide_number,
            question_id=str(question_id),
            question_stem="Formatted stem",
            question="Best next step?",
            choices={"A": "A", "B": "B", "C": "C", "D": "D"},
            correct_answer="A",
            correct_answer_explanation="Because",
            incorrect_explanations={"B": "No", "C": "No", "D": "No"},
            educational_objective="Objective",
            tags={"rotation": "OB-GYN", "topic": "Labor"},
        )

    formatter.format_question = fake_format_question  # type: ignore[assignment]

    base = dict(
        slide_number=15,
        question_index=1,
        question_id="deck-15",
        question_stem="Source stem",
        choices={"A": "A", "B": "B", "C": "C", "D": "D"},
        correct_answer="A",
        correct_answer_text="A",
        rotation="OB-GYN",
    )
    q1 = ExtractedQuestion(explanation="v1 explanation", **base)
    q2 = ExtractedQuestion(explanation="v2 explanation", **base)

    cache_path = tmp_path / "usmle_formatter_cache.json"
    progress_path = tmp_path / "usmle_formatter_progress.json"

    formatter.format_batch(
        [q1],
        checkpoint_every=1,
        cache_path=cache_path,
        progress_path=progress_path,
        source_label="test-input",
    )
    formatter.format_batch(
        [q2],
        checkpoint_every=1,
        cache_path=cache_path,
        progress_path=progress_path,
        source_label="test-input",
    )

    assert calls["count"] == 2


def test_format_batch_cache_miss_when_explanation_images_change(tmp_path):
    formatter = USMLEFormatter.__new__(USMLEFormatter)
    formatter.model_name = "gpt-5.2"
    formatter.provider = "openai"
    formatter.target_rpm = 450
    formatter.max_inflight = 4
    formatter.last_request_time = 0
    formatter.min_request_interval = 0

    calls = {"count": 0}

    def fake_format_question(question, question_id, retries=3):
        calls["count"] += 1
        return USMLEQuestion(
            original_slide_number=question.slide_number,
            question_id=str(question_id),
            question_stem="Formatted stem",
            question="Best next step?",
            choices={"A": "A", "B": "B", "C": "C", "D": "D"},
            correct_answer="A",
            correct_answer_explanation="Because",
            incorrect_explanations={"B": "No", "C": "No", "D": "No"},
            educational_objective="Objective",
            tags={"rotation": "OB-GYN", "topic": "Labor"},
        )

    formatter.format_question = fake_format_question  # type: ignore[assignment]

    base = dict(
        slide_number=16,
        question_index=1,
        question_id="deck-16",
        question_stem="Source stem",
        choices={"A": "A", "B": "B", "C": "C", "D": "D"},
        correct_answer="A",
        correct_answer_text="A",
        explanation="v1 explanation",
        rotation="OB-GYN",
    )
    q1 = ExtractedQuestion(explanation_images=["/tmp/one.png"], **base)
    q2 = ExtractedQuestion(explanation_images=["/tmp/two.png"], **base)

    cache_path = tmp_path / "usmle_formatter_cache.json"
    progress_path = tmp_path / "usmle_formatter_progress.json"

    formatter.format_batch(
        [q1],
        checkpoint_every=1,
        cache_path=cache_path,
        progress_path=progress_path,
        source_label="test-input",
    )
    formatter.format_batch(
        [q2],
        checkpoint_every=1,
        cache_path=cache_path,
        progress_path=progress_path,
        source_label="test-input",
    )

    assert calls["count"] == 2
