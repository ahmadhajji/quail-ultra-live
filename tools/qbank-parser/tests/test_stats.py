"""
Unit tests for the Stats module.

Tests the StatsCollector and StatsReportGenerator classes.
"""

import pytest
import json
import tempfile
from pathlib import Path
from datetime import datetime
from unittest.mock import MagicMock, patch

# Import stats modules
from stats.collector import (
    StatsCollector, 
    AICallStats, 
    ParserStats, 
    QuestionStats,
    init_stats_collector,
    get_stats_collector,
    reset_stats_collector
)
from stats.report_generator import StatsReportGenerator


class TestAICallStats:
    """Tests for the AICallStats dataclass."""
    
    def test_create_stats(self):
        """Test creating AICallStats with basic fields."""
        stats = AICallStats(
            timestamp=datetime.now(),
            model="gemini-3-flash-preview",
            method="text",
            slide_number=5,
            prompt_tokens=100,
            completion_tokens=50,
            total_tokens=150,
            latency_ms=1000.5,
            success=True
        )
        
        assert stats.model == "gemini-3-flash-preview"
        assert stats.method == "text"
        assert stats.slide_number == 5
        assert stats.total_tokens == 150
        assert stats.success is True
    
    def test_to_dict(self):
        """Test converting stats to dictionary."""
        stats = AICallStats(
            timestamp=datetime.now(),
            model="gemini-3-flash-preview",
            method="vision",
            slide_number=10,
            prompt_tokens=200,
            completion_tokens=100,
            total_tokens=300,
            latency_ms=2000.0,
            success=True
        )
        
        d = stats.to_dict()
        
        assert d["method"] == "vision"
        assert d["slide_number"] == 10
        assert d["total_tokens"] == 300
        assert d["latency_ms"] == 2000.0


class TestStatsCollector:
    """Tests for the StatsCollector class."""
    
    def setup_method(self):
        """Reset collector before each test."""
        reset_stats_collector()
    
    def test_singleton_pattern(self):
        """Test that init_stats_collector returns a singleton."""
        collector1 = init_stats_collector()
        collector2 = get_stats_collector()
        
        assert collector1 is collector2
    
    def test_start_sets_time_and_source(self):
        """Test that start() initializes correctly."""
        collector = init_stats_collector()
        collector.start(source_file="test.pptx")
        
        assert collector.start_time is not None
        assert collector.source_file == "test.pptx"
    
    def test_record_ai_call_from_mock_response(self):
        """Test recording an AI call with mock response."""
        collector = init_stats_collector()
        collector.start()
        
        # Create mock response with usage_metadata
        mock_response = MagicMock()
        mock_response.usage_metadata.prompt_token_count = 100
        mock_response.usage_metadata.candidates_token_count = 50
        mock_response.usage_metadata.total_token_count = 150
        mock_response.usage_metadata.thoughts_token_count = 20
        
        collector.record_ai_call(
            response=mock_response,
            model="gemini-3-flash-preview",
            method="text",
            slide_number=1,
            latency_ms=500.0,
            success=True
        )
        
        assert len(collector.ai_calls) == 1
        assert collector.ai_calls[0].prompt_tokens == 100
        assert collector.ai_calls[0].completion_tokens == 50
        assert collector.ai_calls[0].thinking_tokens == 20
    
    def test_record_ai_call_without_response(self):
        """Test recording an AI call without response metadata."""
        collector = init_stats_collector()
        collector.start()
        
        collector.record_ai_call(
            response=None,
            model="gemini-3-flash-preview",
            method="text",
            slide_number=1,
            latency_ms=500.0,
            success=False,
            error="Test error"
        )
        
        assert len(collector.ai_calls) == 1
        assert collector.ai_calls[0].success is False
        assert collector.ai_calls[0].error == "Test error"

    def test_record_ai_call_from_openai_responses_usage(self):
        """Test recording token usage from OpenAI Responses API shape."""
        collector = init_stats_collector()
        collector.start()

        mock_response = MagicMock()
        mock_response.model_dump.return_value = {
            "usage": {
                "input_tokens": 120,
                "output_tokens": 80,
                "total_tokens": 200,
                "output_tokens_details": {"reasoning_tokens": 15},
            }
        }

        collector.record_ai_call(
            response=mock_response,
            model="gpt-5.4",
            method="text",
            slide_number=1,
            latency_ms=500.0,
            success=True,
        )

        summary = collector.finalize()
        assert collector.ai_calls[0].prompt_tokens == 120
        assert collector.ai_calls[0].completion_tokens == 80
        assert collector.ai_calls[0].thinking_tokens == 15
        assert summary["cost_estimate"]["usage_status"] == "known"
    
    def test_disabled_collector_skips_recording(self):
        """Test that disabled collector doesn't record."""
        collector = init_stats_collector(enabled=False)
        collector.record_ai_call(
            response=None,
            model="test",
            method="text",
            slide_number=1,
            latency_ms=100.0,
            success=True
        )
        
        assert len(collector.ai_calls) == 0
    
    def test_finalize_calculates_totals(self):
        """Test that finalize() calculates correct aggregates."""
        collector = init_stats_collector()
        collector.start(source_file="test.pptx")
        
        # Add some mock AI calls
        for i in range(3):
            stats = AICallStats(
                timestamp=datetime.now(),
                model="gemini-3-flash-preview",
                method="text" if i < 2 else "vision",
                slide_number=i + 1,
                prompt_tokens=100,
                completion_tokens=50,
                total_tokens=150,
                latency_ms=1000.0,
                success=True
            )
            collector.ai_calls.append(stats)
        
        summary = collector.finalize()
        
        assert summary["ai_summary"]["total_calls"] == 3
        assert summary["ai_summary"]["total_tokens"] == 450
        assert summary["ai_summary"]["total_prompt_tokens"] == 300
        assert summary["ai_summary"]["calls_by_method"]["text"] == 2
        assert summary["ai_summary"]["calls_by_method"]["vision"] == 1
        assert summary["cost_estimate"]["total_cost_usd"] > 0
    
    def test_reset_clears_all_data(self):
        """Test that reset() clears all collected data."""
        collector = init_stats_collector()
        collector.start(source_file="test.pptx")
        collector.ai_calls.append(AICallStats(
            timestamp=datetime.now(),
            model="test",
            method="text",
            slide_number=1
        ))
        
        collector.reset()
        
        assert len(collector.ai_calls) == 0
        assert collector.start_time is None
        assert collector.source_file == ""


class TestStatsReportGenerator:
    """Tests for the StatsReportGenerator class."""
    
    def get_sample_stats(self) -> dict:
        """Create sample stats for testing."""
        return {
            "meta": {
                "source_file": "test.pptx",
                "start_time": datetime.now().isoformat(),
                "end_time": datetime.now().isoformat(),
                "duration_seconds": 10.5,
                "generated_at": datetime.now().isoformat()
            },
            "parser": {
                "total_slides": 50,
                "slides_with_text": 45,
                "slides_with_images": 30,
                "total_images_extracted": 60
            },
            "questions": {
                "valid_questions": 40,
                "multi_question_slides": 5,
                "avg_confidence": 85.5
            },
            "ai_summary": {
                "total_calls": 50,
                "successful_calls": 48,
                "failed_calls": 2,
                "total_tokens": 50000,
                "total_prompt_tokens": 30000,
                "total_completion_tokens": 20000,
                "total_thinking_tokens": 5000,
                "avg_latency_ms": 1200.0,
                "total_latency_ms": 60000.0,
                "calls_by_method": {
                    "text": 40,
                    "vision": 8,
                    "classification": 2
                }
            },
            "cost_estimate": {
                "input_cost_usd": 0.003,
                "output_cost_usd": 0.008,
                "total_cost_usd": 0.011,
                "pricing_note": "Test pricing"
            },
            "ai_calls": [
                {
                    "timestamp": datetime.now().isoformat(),
                    "model": "gemini-3-flash-preview",
                    "method": "text",
                    "slide_number": i,
                    "prompt_tokens": 600,
                    "completion_tokens": 400,
                    "total_tokens": 1000,
                    "latency_ms": 1200.0,
                    "success": True,
                    "error": ""
                }
                for i in range(1, 6)
            ]
        }
    
    def test_generate_html_creates_file(self):
        """Test that HTML report is generated."""
        generator = StatsReportGenerator()
        stats = self.get_sample_stats()
        
        with tempfile.TemporaryDirectory() as tmpdir:
            output_path = Path(tmpdir) / "stats_report.html"
            result = generator.generate_html(stats, output_path)
            
            assert result.exists()
            content = result.read_text()
            
            # Check key elements are present
            assert "Stats for Nerds" in content
            assert "test.pptx" in content
            assert "Chart.js" in content or "chart.js" in content.lower()
            assert "tokenChart" in content
    
    def test_generate_markdown_creates_file(self):
        """Test that markdown report is generated."""
        generator = StatsReportGenerator()
        stats = self.get_sample_stats()
        
        with tempfile.TemporaryDirectory() as tmpdir:
            output_path = Path(tmpdir) / "stats_report.md"
            result = generator.generate_markdown(stats, output_path)
            
            assert result.exists()
            content = result.read_text()
            
            # Check key elements are present
            assert "QBank Parser Stats Report" in content
            assert "test.pptx" in content
            assert "Total Slides" in content
            assert "50" in content  # total_slides


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
