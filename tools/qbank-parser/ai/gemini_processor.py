"""
Legacy compatibility shim for removed Gemini inference support.

The app is OpenAI-only for model inference. Google APIs remain supported for
Slides export/comments, but Gemini models are not.
"""

from __future__ import annotations

from domain.models import ExtractedQuestion


class GeminiProcessor:
    """Compatibility stub that fails fast when legacy Gemini inference is used."""

    def __init__(self, *_args, **_kwargs):
        raise RuntimeError(
            "Gemini model inference has been removed. "
            "Use OpenAI extraction/formatting instead."
        )


def test_gemini_connection(_api_key: str) -> bool:
    """Gemini inference is no longer supported."""
    return False
