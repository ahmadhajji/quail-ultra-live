"""Response parsing and resilient JSON repair helpers."""

from __future__ import annotations

import json
import re


def repair_json_text(text: str) -> str:
    repaired = text.strip()
    repaired = re.sub(r'"quality_flags"\s*:\s*$', '"quality_flags": []', repaired, flags=re.IGNORECASE)
    repaired = re.sub(r",(\s*[}\]])", r"\1", repaired)

    curly_balance = repaired.count("{") - repaired.count("}")
    square_balance = repaired.count("[") - repaired.count("]")
    if square_balance > 0:
        repaired += "]" * square_balance
    if curly_balance > 0:
        repaired += "}" * curly_balance
    return repaired


def parse_json_response(response_text: str) -> dict:
    text = (response_text or "").strip()

    if text.startswith("```json"):
        text = text[7:]
    elif text.startswith("```"):
        text = text[3:]
    if text.endswith("```"):
        text = text[:-3]

    text = text.strip()
    parse_candidates = [text]

    start = text.find("{")
    end = text.rfind("}") + 1
    if start >= 0 and end > start:
        parse_candidates.append(text[start:end])

    for candidate in list(parse_candidates):
        repaired = repair_json_text(candidate)
        if repaired != candidate:
            parse_candidates.append(repaired)

    last_error: Exception | None = None
    for candidate in parse_candidates:
        try:
            return json.loads(candidate)
        except Exception as e:
            last_error = e

    if last_error:
        raise last_error
    raise ValueError("Unable to parse JSON response")
