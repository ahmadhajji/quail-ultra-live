"""OpenAI pricing helpers for parser cost reports."""

from __future__ import annotations

from dataclasses import dataclass


WEB_SEARCH_COST_PER_CALL = 10.0 / 1000.0


@dataclass(frozen=True)
class ModelPrice:
    input_per_million: float
    cached_input_per_million: float
    output_per_million: float


MODEL_PRICES: dict[str, ModelPrice] = {
    "gpt-5.4-mini": ModelPrice(input_per_million=0.75, cached_input_per_million=0.075, output_per_million=4.50),
    "gpt-5.4": ModelPrice(input_per_million=2.50, cached_input_per_million=0.25, output_per_million=15.00),
    "gpt-5.5": ModelPrice(input_per_million=5.00, cached_input_per_million=0.50, output_per_million=30.00),
}


def normalize_model_name(model: str) -> str:
    cleaned = (model or "").strip()
    for known in sorted(MODEL_PRICES, key=len, reverse=True):
        if cleaned == known or cleaned.startswith(f"{known}-"):
            return known
    return cleaned


def estimate_openai_cost(
    *,
    model: str,
    input_tokens: int = 0,
    cached_input_tokens: int = 0,
    output_tokens: int = 0,
    web_search_calls: int = 0,
) -> dict[str, float | str]:
    normalized = normalize_model_name(model)
    price = MODEL_PRICES.get(normalized)
    if price is None:
        return {
            "model": normalized,
            "input_cost_usd": 0.0,
            "cached_input_cost_usd": 0.0,
            "output_cost_usd": 0.0,
            "web_search_cost_usd": round(web_search_calls * WEB_SEARCH_COST_PER_CALL, 6),
            "total_cost_usd": round(web_search_calls * WEB_SEARCH_COST_PER_CALL, 6),
            "pricing_status": "unknown_model",
        }

    uncached_input_tokens = max(0, int(input_tokens) - int(cached_input_tokens))
    input_cost = uncached_input_tokens / 1_000_000 * price.input_per_million
    cached_cost = int(cached_input_tokens) / 1_000_000 * price.cached_input_per_million
    output_cost = int(output_tokens) / 1_000_000 * price.output_per_million
    search_cost = int(web_search_calls) * WEB_SEARCH_COST_PER_CALL
    total = input_cost + cached_cost + output_cost + search_cost
    return {
        "model": normalized,
        "input_cost_usd": round(input_cost, 6),
        "cached_input_cost_usd": round(cached_cost, 6),
        "output_cost_usd": round(output_cost, 6),
        "web_search_cost_usd": round(search_cost, 6),
        "total_cost_usd": round(total, 6),
        "pricing_status": "known",
    }
