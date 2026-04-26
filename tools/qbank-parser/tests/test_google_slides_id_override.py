from __future__ import annotations

from pathlib import Path

import main


def _stub_parse_pptx(_pptx_path: str | Path, _output_dir: Path):
    return []


def test_parse_uses_explicit_google_slides_id(monkeypatch, tmp_path):
    pptx_file = tmp_path / "deck.pptx"
    pptx_file.write_bytes(b"placeholder")

    captured: dict[str, str] = {}

    def fake_fetch_comments(presentation_id: str):
        captured["presentation_id"] = presentation_id
        return []

    monkeypatch.setattr(main, "parse_pptx", _stub_parse_pptx)
    monkeypatch.setattr(main, "fetch_comments", fake_fetch_comments)
    monkeypatch.setattr(main, "get_comments_by_slide", lambda _comments: {})
    monkeypatch.setattr(main, "GOOGLE_SLIDES_ID", "env-id")

    main.parse_presentation(
        str(pptx_file),
        use_ai=False,
        use_google_api=True,
        google_slides_id="explicit-id",
    )

    assert captured["presentation_id"] == "explicit-id"


def test_parse_falls_back_to_env_google_slides_id(monkeypatch, tmp_path):
    pptx_file = tmp_path / "deck.pptx"
    pptx_file.write_bytes(b"placeholder")

    captured: dict[str, str] = {}

    def fake_fetch_comments(presentation_id: str):
        captured["presentation_id"] = presentation_id
        return []

    monkeypatch.setattr(main, "parse_pptx", _stub_parse_pptx)
    monkeypatch.setattr(main, "fetch_comments", fake_fetch_comments)
    monkeypatch.setattr(main, "get_comments_by_slide", lambda _comments: {})
    monkeypatch.setattr(main, "GOOGLE_SLIDES_ID", "env-id")

    main.parse_presentation(
        str(pptx_file),
        use_ai=False,
        use_google_api=True,
        google_slides_id=None,
    )

    assert captured["presentation_id"] == "env-id"


def test_parse_skips_google_fetch_when_no_slides_id(monkeypatch, tmp_path):
    pptx_file = tmp_path / "deck.pptx"
    pptx_file.write_bytes(b"placeholder")

    called = {"fetch": False}

    def fake_fetch_comments(_presentation_id: str):
        called["fetch"] = True
        return []

    monkeypatch.setattr(main, "parse_pptx", _stub_parse_pptx)
    monkeypatch.setattr(main, "fetch_comments", fake_fetch_comments)
    monkeypatch.setattr(main, "GOOGLE_SLIDES_ID", "")

    main.parse_presentation(
        str(pptx_file),
        use_ai=False,
        use_google_api=True,
        google_slides_id=None,
    )

    assert called["fetch"] is False
