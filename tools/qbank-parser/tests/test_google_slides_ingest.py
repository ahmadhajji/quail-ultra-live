from __future__ import annotations

from pathlib import Path

import parsers.google_api as google_api


def test_extract_presentation_id_accepts_url():
    parsed = google_api.extract_presentation_id(
        "https://docs.google.com/presentation/d/1AbC_DeF0123456789xyz/edit#slide=id.p"
    )
    assert parsed == "1AbC_DeF0123456789xyz"


def test_extract_presentation_id_accepts_raw_id():
    parsed = google_api.extract_presentation_id("1AbC_DeF0123456789xyz")
    assert parsed == "1AbC_DeF0123456789xyz"


def test_extract_presentation_id_rejects_invalid():
    try:
        google_api.extract_presentation_id("not-a-valid-input")
    except ValueError as exc:
        assert "Invalid Google Slides input" in str(exc)
    else:
        raise AssertionError("Expected ValueError for invalid input")


def test_fetch_presentation_title(monkeypatch):
    monkeypatch.setattr(google_api, "GOOGLE_API_AVAILABLE", True)
    monkeypatch.setattr(google_api, "get_credentials", lambda _path="credentials.json": object())

    class FakeSlidesService:
        def presentations(self):
            return self

        def get(self, presentationId):
            assert presentationId == "deck-id"
            return self

        def execute(self):
            return {"title": "Internal Medicine 1"}

    monkeypatch.setattr(
        google_api,
        "build",
        lambda service, _version, credentials=None: FakeSlidesService()
        if service == "slides"
        else None,
    )

    assert google_api.fetch_presentation_title("deck-id") == "Internal Medicine 1"


def test_export_presentation_to_pptx(monkeypatch, tmp_path):
    monkeypatch.setattr(google_api, "GOOGLE_API_AVAILABLE", True)
    monkeypatch.setattr(google_api, "get_credentials", lambda _path="credentials.json": object())

    class FakeDriveService:
        def files(self):
            return self

        def export_media(self, fileId, mimeType):
            assert fileId == "deck-id"
            assert mimeType == "application/vnd.openxmlformats-officedocument.presentationml.presentation"
            return object()

    monkeypatch.setattr(
        google_api,
        "build",
        lambda service, _version, credentials=None: FakeDriveService()
        if service == "drive"
        else None,
    )

    class FakeDownloader:
        def __init__(self, buffer, _request):
            self.buffer = buffer
            self.done = False

        def next_chunk(self):
            if not self.done:
                self.buffer.write(b"pptx-bytes")
                self.done = True
            return (None, self.done)

    monkeypatch.setattr(google_api, "MediaIoBaseDownload", FakeDownloader)

    out_path = tmp_path / "deck.pptx"
    exported = google_api.export_presentation_to_pptx("deck-id", out_path)
    assert exported == out_path.resolve()
    assert exported.read_bytes() == b"pptx-bytes"

