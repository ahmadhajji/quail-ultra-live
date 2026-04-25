"""OpenAI formatter provider adapter."""

from __future__ import annotations

from typing import Callable


class OpenAIFormatterAdapter:
    """Adapter for OpenAI Responses API used by USMLE formatting."""

    def __init__(
        self,
        *,
        client,
        model_name: str,
        reasoning_effort: str,
        web_search_enabled: bool,
        response_schema: dict,
        model_access_error_factory: Callable[[str], Exception],
        rate_limit_error_factory: Callable[[str, float | None], Exception],
    ):
        self.client = client
        self.model_name = model_name
        self.reasoning_effort = reasoning_effort
        self.web_search_enabled = web_search_enabled
        self.response_schema = response_schema
        self._model_access_error_factory = model_access_error_factory
        self._rate_limit_error_factory = rate_limit_error_factory

    @staticmethod
    def is_rate_limit_error(message: str) -> bool:
        if not message:
            return False
        text = message.lower()
        return " 429" in text or "http 429" in text or "rate limit" in text or "quota" in text

    @staticmethod
    def is_model_access_error(message: str) -> bool:
        text = (message or "").lower()
        return "model" in text and (
            "not found" in text
            or "does not exist" in text
            or "access" in text
            or "permission" in text
            or "unauthorized" in text
        )

    @staticmethod
    def extract_retry_after_seconds(message: str) -> float | None:
        import re

        if not message:
            return None

        m = re.search(r"retry[_\s-]*after\s*[:=]\s*([0-9]+(?:\.[0-9]+)?)", message, flags=re.IGNORECASE)
        if m:
            return float(m.group(1))

        m = re.search(r"Please retry in\s*([0-9]+)h([0-9]+)m([0-9]+(?:\.[0-9]+)?)s", message)
        if m:
            return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))

        m = re.search(r"Please try again in\s*([0-9]+(?:\.[0-9]+)?)s", message, flags=re.IGNORECASE)
        if m:
            return float(m.group(1))

        return None

    @staticmethod
    def _extract_urls(value, urls: set[str]) -> None:
        if isinstance(value, dict):
            for k, v in value.items():
                if isinstance(v, str) and v.startswith(("http://", "https://")):
                    urls.add(v)
                elif (
                    isinstance(k, str)
                    and "url" in k.lower()
                    and isinstance(v, str)
                    and v.startswith(("http://", "https://"))
                ):
                    urls.add(v)
                else:
                    OpenAIFormatterAdapter._extract_urls(v, urls)
        elif isinstance(value, list):
            for item in value:
                OpenAIFormatterAdapter._extract_urls(item, urls)

    def build_request_payload(self, prompt: str) -> dict:
        tools = [{"type": "web_search"}] if self.web_search_enabled else []
        return {
            "model": self.model_name,
            "input": prompt,
            "reasoning": {"effort": self.reasoning_effort},
            "tools": tools,
            "text": {
                "format": {
                    "type": "json_schema",
                    "name": "usmle_question",
                    "schema": self.response_schema,
                    "strict": True,
                }
            },
        }

    def generate_content(self, prompt: str) -> tuple[str, list[str]]:
        payload = self.build_request_payload(prompt)

        try:
            response = self.client.responses.create(**payload)
        except Exception as e:  # pragma: no cover - live API behavior
            message = str(e)
            status_code = getattr(e, "status_code", None)
            if status_code is None:
                status_code = getattr(e, "status", None)

            retry_after = None
            response_obj = getattr(e, "response", None)
            headers = getattr(response_obj, "headers", {}) if response_obj else {}
            if headers:
                value = headers.get("retry-after") or headers.get("Retry-After")
                if value:
                    try:
                        retry_after = float(value)
                    except Exception:
                        retry_after = None

            if status_code in {401, 403, 404} or self.is_model_access_error(message):
                raise self._model_access_error_factory(message) from e

            if status_code == 429 or self.is_rate_limit_error(message):
                raise self._rate_limit_error_factory(message, retry_after) from e

            raise RuntimeError(message) from e

        if hasattr(response, "output_text") and response.output_text:
            response_text = response.output_text
        else:
            response_dict = response.model_dump() if hasattr(response, "model_dump") else {}
            text_chunks: list[str] = []
            for output_item in response_dict.get("output", []):
                for content_item in output_item.get("content", []):
                    ctype = content_item.get("type")
                    if ctype in {"output_text", "text"} and content_item.get("text"):
                        text_chunks.append(content_item["text"])
            response_text = "".join(text_chunks)

        if not response_text:
            raise RuntimeError("OpenAI returned empty output_text")

        sources: set[str] = set()
        response_dump = response.model_dump() if hasattr(response, "model_dump") else {}
        self._extract_urls(response_dump, sources)

        return response_text, sorted(sources)
