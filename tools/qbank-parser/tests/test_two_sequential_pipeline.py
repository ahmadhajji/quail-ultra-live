from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import main


def _write_extracted_json(path: Path, question_id: str = "12") -> None:
    payload = {
        "export_date": "2026-03-05T00:00:00",
        "total_slides": 1,
        "valid_questions": 1,
        "questions": [
            {
                "slide_number": 12,
                "question_index": 1,
                "question_id": question_id,
                "variant_label": "",
                "is_valid_question": True,
                "question_stem": "Example stem",
                "choices": {"A": "One", "B": "Two", "C": "Three", "D": "Four"},
                "correct_answer": "A",
                "correct_answer_text": "One",
                "confidence": 90,
                "explanation": "Explanation",
                "flags": [],
                "source_of_answer": "notes",
                "rotation": "",
                "images": [],
                "extraction_method": "text",
                "comments": [],
                "error": "",
            }
        ],
    }
    path.write_text(json.dumps(payload), encoding="utf-8")


def test_run_two_sequential_prefixes_question_ids(monkeypatch, tmp_path):
    monkeypatch.setattr(main, "OUTPUT_DIR", tmp_path)
    monkeypatch.setattr(main, "print_banner", lambda: None)

    inputs = ["id-one", "id-two"]
    titles = ["Internal Medicine 1 Batch", "Pediatrics Block 2"]
    ids_seen: list[str] = []
    parse_calls = {"count": 0}
    captured_formatted_ids: list[str] = []

    monkeypatch.setattr(main, "extract_presentation_id", lambda raw: raw)
    monkeypatch.setattr(main, "fetch_presentation_title", lambda _pid: titles[len(ids_seen)])

    def fake_export(presentation_id: str, out_path: Path):
        ids_seen.append(presentation_id)
        out_path.write_bytes(b"pptx")
        return out_path

    monkeypatch.setattr(main, "export_presentation_to_pptx", fake_export)

    def fake_parse_presentation(*_args, **_kwargs):
        parse_calls["count"] += 1
        _write_extracted_json(tmp_path / "extracted_questions.json", question_id="12")
        return True

    monkeypatch.setattr(main, "parse_presentation", fake_parse_presentation)

    monkeypatch.setattr(main, "export_to_csv", lambda *_args, **_kwargs: tmp_path / "extracted_questions.csv")

    def fake_format(questions, source_file=None, **_kwargs):
        captured_formatted_ids.extend([q.question_id for q in questions])
        output = tmp_path / "usmle_formatted_questions.json"
        output.write_text(json.dumps({"questions": []}), encoding="utf-8")
        return output, tmp_path / "usmle_formatted_questions.md", None

    monkeypatch.setattr(main, "format_questions_to_usmle_outputs", fake_format)
    monkeypatch.setattr(
        main,
        "export_quail_qbank",
        lambda **_kwargs: SimpleNamespace(total_questions=2, output_dir=tmp_path / "quail_qbank"),
    )

    main.run_two_sequential(
        inputs=inputs,
        rotations=["Internal Medicine", "Pediatrics"],
        speed_profile="balanced",
        ai_workers=1,
        checkpoint_every=1,
        use_google_api=False,
        quail_output_dir=None,
        quail_images_dir=None,
        quail_append=False,
        formatter_provider="openai",
        openai_model="gpt-5.2",
        openai_reasoning_effort="high",
        openai_web_search=True,
        openai_target_rpm=450,
        openai_max_inflight=120,
        archive_current_format_state=False,
    )

    assert parse_calls["count"] == 2
    assert len(captured_formatted_ids) == 2
    assert captured_formatted_ids[0].startswith("internal-medicine-1-batch-")
    assert captured_formatted_ids[1].startswith("pediatrics-block-2-")
    assert captured_formatted_ids[0].endswith("-12")
    assert captured_formatted_ids[1].endswith("-12")
