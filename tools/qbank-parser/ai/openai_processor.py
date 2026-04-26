"""
OpenAI Extraction Processor

Compatibility facade over the OpenAI extraction provider adapter.
"""

from __future__ import annotations

from openai import OpenAI

from domain.models import ExtractedQuestion
from providers.extraction.openai_adapter import OPENAI_EXTRACTION_SCHEMA, OpenAIExtractionAdapter


class OpenAIProcessor:
    """Extract medical questions from slide text/images using OpenAI."""

    def __init__(
        self,
        api_key: str,
        model_name: str = "gpt-4.1-mini",
        prompt_mode: str = "standard",
        min_request_interval: float = 0.0,
    ):
        self.adapter = OpenAIExtractionAdapter(
            api_key=api_key,
            model_name=model_name,
            prompt_mode=prompt_mode,
            min_request_interval=min_request_interval,
        )

    def __getattr__(self, name: str):
        """Maintain compatibility for legacy attribute/method access."""
        return getattr(self.adapter, name)

    @property
    def client(self):
        return self.adapter.client

    @property
    def model_name(self):
        return self.adapter.model_name

    @property
    def prompt_mode(self):
        return self.adapter.prompt_mode

    @property
    def last_request_time(self):
        return self.adapter.last_request_time

    @last_request_time.setter
    def last_request_time(self, value):
        self.adapter.last_request_time = value

    @property
    def min_request_interval(self):
        return self.adapter.min_request_interval

    @min_request_interval.setter
    def min_request_interval(self, value):
        self.adapter.min_request_interval = value

    def extract_from_text(
        self,
        slide_number: int,
        slide_text: str,
        speaker_notes: str = "",
        highlighted: str = "",
        comments: str = "",
        images: list[str] | None = None,
    ) -> list[ExtractedQuestion]:
        return self.adapter.extract_from_text(
            slide_number=slide_number,
            slide_text=slide_text,
            speaker_notes=speaker_notes,
            highlighted=highlighted,
            comments=comments,
            images=images,
        )

    def extract_from_image(
        self,
        slide_number: int,
        image_paths: list[str],
        speaker_notes: str = "",
        highlighted: str = "",
        comments: str = "",
    ) -> list[ExtractedQuestion]:
        return self.adapter.extract_from_image(
            slide_number=slide_number,
            image_paths=image_paths,
            speaker_notes=speaker_notes,
            highlighted=highlighted,
            comments=comments,
        )

    def process_slide(
        self,
        slide_number: int,
        slide_text: str,
        speaker_notes: str = "",
        highlighted: str = "",
        comments: str = "",
        images: list[str] | None = None,
        slide_image_path: str = "",
    ) -> list[ExtractedQuestion]:
        return self.adapter.process_slide(
            slide_number=slide_number,
            slide_text=slide_text,
            speaker_notes=speaker_notes,
            highlighted=highlighted,
            comments=comments,
            images=images,
            slide_image_path=slide_image_path,
        )


def test_openai_connection(api_key: str, model_name: str = "gpt-4.1-mini") -> bool:
    """Quick connectivity test for OpenAI extraction model."""
    try:
        client = OpenAI(api_key=api_key)
        response = client.responses.create(
            model=model_name,
            input="Reply with exactly: API connection successful",
        )
        text = getattr(response, "output_text", "") or ""
        return "successful" in text.lower()
    except Exception:
        return False
