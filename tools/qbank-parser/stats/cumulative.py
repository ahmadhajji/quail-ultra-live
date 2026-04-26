"""
Cumulative Stats Tracker

Maintains persistent all-time statistics across multiple runs.
This file is never archived - it stays in the stats/ directory.
"""

import json
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, Optional


# Persistent stats file location (stays even when output is archived)
CUMULATIVE_STATS_FILE = Path(__file__).parent / "cumulative.json"


def get_empty_cumulative_stats() -> Dict[str, Any]:
    """Return the structure of empty cumulative stats."""
    return {
        "all_time": {
            "first_run": None,
            "last_run": None,
            "total_runs": 0,
            "total_slides_processed": 0,
            "total_questions_extracted": 0,
            "total_ai_calls": 0,
            "total_tokens": 0,
            "total_prompt_tokens": 0,
            "total_completion_tokens": 0,
            "total_thinking_tokens": 0,
            "total_latency_ms": 0,
            "estimated_cost_usd": 0.0,
            "calls_by_method": {
                "text": 0,
                "vision": 0,
                "classification": 0
            }
        },
        "runs": []  # List of run summaries
    }


def load_cumulative_stats() -> Dict[str, Any]:
    """Load cumulative stats from persistent file."""
    if CUMULATIVE_STATS_FILE.exists():
        try:
            with open(CUMULATIVE_STATS_FILE, 'r') as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            pass
    return get_empty_cumulative_stats()


def save_cumulative_stats(stats: Dict[str, Any]) -> None:
    """Save cumulative stats to persistent file."""
    CUMULATIVE_STATS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(CUMULATIVE_STATS_FILE, 'w') as f:
        json.dump(stats, f, indent=2)


def update_cumulative_stats(run_stats: Dict[str, Any]) -> Dict[str, Any]:
    """
    Update cumulative stats with data from a completed run.
    
    Args:
        run_stats: The stats dictionary from StatsCollector.finalize()
        
    Returns:
        Updated cumulative stats dictionary
    """
    cumulative = load_cumulative_stats()
    all_time = cumulative["all_time"]
    
    # Update timestamps
    now = datetime.now().isoformat()
    if all_time["first_run"] is None:
        all_time["first_run"] = now
    all_time["last_run"] = now
    
    # Update counters
    all_time["total_runs"] += 1
    
    # Parser stats
    parser = run_stats.get("parser", {})
    all_time["total_slides_processed"] += parser.get("total_slides", 0)
    
    # Question stats
    questions = run_stats.get("questions", {})
    all_time["total_questions_extracted"] += questions.get("valid_questions", 0)
    
    # AI stats
    ai = run_stats.get("ai_summary", {})
    all_time["total_ai_calls"] += ai.get("total_calls", 0)
    all_time["total_tokens"] += ai.get("total_tokens", 0)
    all_time["total_prompt_tokens"] += ai.get("total_prompt_tokens", 0)
    all_time["total_completion_tokens"] += ai.get("total_completion_tokens", 0)
    all_time["total_thinking_tokens"] += ai.get("total_thinking_tokens", 0)
    all_time["total_latency_ms"] += ai.get("total_latency_ms", 0)
    
    # Method breakdown
    calls_by_method = ai.get("calls_by_method", {})
    for method in ["text", "vision", "classification"]:
        all_time["calls_by_method"][method] += calls_by_method.get(method, 0)
    
    # Cost
    cost = run_stats.get("cost_estimate", {})
    all_time["estimated_cost_usd"] += cost.get("total_cost_usd", 0)
    
    # Add run summary to history (keep last 100 runs)
    run_summary = {
        "timestamp": now,
        "source_file": run_stats.get("meta", {}).get("source_file", "unknown"),
        "slides": parser.get("total_slides", 0),
        "questions": questions.get("valid_questions", 0),
        "tokens": ai.get("total_tokens", 0),
        "cost_usd": cost.get("total_cost_usd", 0),
        "duration_seconds": run_stats.get("meta", {}).get("duration_seconds", 0)
    }
    cumulative["runs"].append(run_summary)
    
    # Keep only last 100 runs in history
    if len(cumulative["runs"]) > 100:
        cumulative["runs"] = cumulative["runs"][-100:]
    
    # Save and return
    save_cumulative_stats(cumulative)
    return cumulative


def get_cumulative_summary() -> Optional[Dict[str, Any]]:
    """Get a summary of all-time stats for display."""
    cumulative = load_cumulative_stats()
    
    if cumulative["all_time"]["total_runs"] == 0:
        return None
    
    all_time = cumulative["all_time"]
    
    return {
        "total_runs": all_time["total_runs"],
        "first_run": all_time["first_run"],
        "last_run": all_time["last_run"],
        "slides_processed": all_time["total_slides_processed"],
        "questions_extracted": all_time["total_questions_extracted"],
        "ai_calls": all_time["total_ai_calls"],
        "tokens_used": all_time["total_tokens"],
        "total_cost_usd": all_time["estimated_cost_usd"],
        "avg_tokens_per_run": all_time["total_tokens"] // max(1, all_time["total_runs"]),
        "avg_cost_per_run": all_time["estimated_cost_usd"] / max(1, all_time["total_runs"]),
        "calls_by_method": all_time["calls_by_method"]
    }


def format_cumulative_report() -> str:
    """Format cumulative stats as a readable string for terminal output."""
    summary = get_cumulative_summary()
    
    if not summary:
        return "No cumulative stats yet. Run your first parse with --stats!"
    
    return f"""
📊 All-Time Stats
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Total Runs:          {summary['total_runs']}
  Slides Processed:    {summary['slides_processed']:,}
  Questions Extracted: {summary['questions_extracted']:,}
  
  AI API Calls:        {summary['ai_calls']:,}
  Total Tokens:        {summary['tokens_used']:,}
  Avg Tokens/Run:      {summary['avg_tokens_per_run']:,}
  
  Total Cost:          ${summary['total_cost_usd']:.4f}
  Avg Cost/Run:        ${summary['avg_cost_per_run']:.4f}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""
