from __future__ import annotations

from stats.pricing import estimate_openai_cost


def test_openai_pricing_includes_cached_input_output_and_web_search():
    estimate = estimate_openai_cost(
        model="gpt-5.4-2026-03-05",
        input_tokens=1_000_000,
        cached_input_tokens=100_000,
        output_tokens=100_000,
        web_search_calls=3,
    )

    assert estimate["model"] == "gpt-5.4"
    assert estimate["input_cost_usd"] == 2.25
    assert estimate["cached_input_cost_usd"] == 0.025
    assert estimate["output_cost_usd"] == 1.5
    assert estimate["web_search_cost_usd"] == 0.03
    assert estimate["total_cost_usd"] == 3.805
