from __future__ import annotations

from export.usmle_formatter import ModelAccessError, ProviderRateLimitError, USMLEFormatter
from providers.formatter.openai_adapter import OpenAIFormatterAdapter


def _minimal_json_response() -> str:
    return (
        '{"question_stem":"s","question":"q","choices":{"A":"a","B":"b","C":"c","D":"d"},'
        '"correct_answer":"A","correct_answer_explanation":"e","incorrect_explanations":{"B":"x"},'
        '"educational_objective":"o","tags":{"rotation":"Internal Medicine","topic":"Cardiology"}}'
    )


def test_openai_request_contains_model_reasoning_and_web_search():
    captured = {}

    class FakeResponse:
        output_text = _minimal_json_response()

        def model_dump(self):
            return {
                "output": [
                    {
                        "content": [
                            {
                                "type": "output_text",
                                "text": self.output_text,
                                "annotations": [{"url": "https://example.com/source"}],
                            }
                        ]
                    }
                ]
            }

    class FakeResponses:
        def create(self, **kwargs):
            captured.update(kwargs)
            return FakeResponse()

    class FakeOpenAIClient:
        responses = FakeResponses()

    formatter = USMLEFormatter.__new__(USMLEFormatter)
    formatter.openai_client = FakeOpenAIClient()
    formatter.model_name = "gpt-5.2"
    formatter.reasoning_effort = "high"
    formatter.web_search_enabled = True

    response_text, sources = formatter._generate_content_openai("prompt text")

    assert response_text
    assert "example.com/source" in ",".join(sources)
    assert captured["model"] == "gpt-5.2"
    assert captured["reasoning"] == {"effort": "high"}
    assert captured["tools"] == [{"type": "web_search"}]
    assert captured["text"]["format"]["type"] == "json_schema"
    assert captured["text"]["format"]["strict"] is True


def test_openai_adapter_request_payload_snapshot():
    adapter = OpenAIFormatterAdapter(
        client=object(),
        model_name="gpt-5.2",
        reasoning_effort="high",
        web_search_enabled=True,
        response_schema={"type": "object"},
        model_access_error_factory=lambda message: RuntimeError(message),
        rate_limit_error_factory=lambda message, retry_after: RuntimeError(message),
    )

    payload = adapter.build_request_payload("prompt text")

    assert payload == {
        "model": "gpt-5.2",
        "input": "prompt text",
        "reasoning": {"effort": "high"},
        "tools": [{"type": "web_search"}],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "usmle_question",
                "schema": {"type": "object"},
                "strict": True,
            }
        },
    }


def test_openai_model_access_error_is_fail_fast():
    class FakeResponse:
        headers = {}

    class FakeError(Exception):
        def __init__(self):
            super().__init__("model not found")
            self.status_code = 404
            self.response = FakeResponse()

    class FakeResponses:
        def create(self, **kwargs):
            raise FakeError()

    class FakeOpenAIClient:
        responses = FakeResponses()

    formatter = USMLEFormatter.__new__(USMLEFormatter)
    formatter.openai_client = FakeOpenAIClient()
    formatter.model_name = "gpt-5.2"
    formatter.reasoning_effort = "high"
    formatter.web_search_enabled = True

    try:
        formatter._generate_content_openai("prompt text")
    except ModelAccessError as e:
        assert "model" in str(e).lower()
    else:
        raise AssertionError("Expected ModelAccessError for 404 model access failure")


def test_openai_rate_limit_error_includes_retry_after():
    class FakeResponse:
        headers = {"retry-after": "2.5"}

    class FakeError(Exception):
        def __init__(self):
            super().__init__("rate limit exceeded")
            self.status_code = 429
            self.response = FakeResponse()

    class FakeResponses:
        def create(self, **kwargs):
            raise FakeError()

    class FakeOpenAIClient:
        responses = FakeResponses()

    formatter = USMLEFormatter.__new__(USMLEFormatter)
    formatter.openai_client = FakeOpenAIClient()
    formatter.model_name = "gpt-5.2"
    formatter.reasoning_effort = "high"
    formatter.web_search_enabled = True

    try:
        formatter._generate_content_openai("prompt text")
    except ProviderRateLimitError as e:
        assert "rate limit" in str(e).lower()
        assert e.retry_after_seconds == 2.5
    else:
        raise AssertionError("Expected ProviderRateLimitError for 429 response")
