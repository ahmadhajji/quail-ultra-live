"""
Stats Collector Module

Provides centralized statistics collection for QBank Parser.
Tracks AI API usage, token counts, latency, and parsing metrics.
"""

import time
import threading
from datetime import datetime
from dataclasses import dataclass, field
from typing import List, Optional, Any
from pathlib import Path


@dataclass
class AICallStats:
    """Statistics for a single AI API call."""
    timestamp: datetime
    model: str
    method: str  # "text", "vision", or "classification"
    slide_number: int
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    thinking_tokens: int = 0  # Tokens used in thinking mode
    usage_available: bool = False
    latency_ms: float = 0.0
    success: bool = True
    error: str = ""
    
    def to_dict(self) -> dict:
        return {
            "timestamp": self.timestamp.isoformat(),
            "model": self.model,
            "method": self.method,
            "slide_number": self.slide_number,
            "prompt_tokens": self.prompt_tokens,
            "completion_tokens": self.completion_tokens,
            "total_tokens": self.total_tokens,
            "thinking_tokens": self.thinking_tokens,
            "usage_available": self.usage_available,
            "latency_ms": round(self.latency_ms, 2),
            "success": self.success,
            "error": self.error
        }


@dataclass
class ParserStats:
    """Statistics from PPTX parsing phase."""
    total_slides: int = 0
    slides_with_text: int = 0
    slides_with_images: int = 0
    total_images_extracted: int = 0
    total_text_characters: int = 0
    slides_with_speaker_notes: int = 0
    slides_with_highlights: int = 0
    processing_time_ms: float = 0.0
    
    def to_dict(self) -> dict:
        return {
            "total_slides": self.total_slides,
            "slides_with_text": self.slides_with_text,
            "slides_with_images": self.slides_with_images,
            "total_images_extracted": self.total_images_extracted,
            "total_text_characters": self.total_text_characters,
            "slides_with_speaker_notes": self.slides_with_speaker_notes,
            "slides_with_highlights": self.slides_with_highlights,
            "processing_time_ms": round(self.processing_time_ms, 2)
        }


@dataclass
class CommentStats:
    """Statistics from Google API comments fetching."""
    total_comments: int = 0
    slides_with_comments: int = 0
    total_replies: int = 0
    fetch_time_ms: float = 0.0
    
    def to_dict(self) -> dict:
        return {
            "total_comments": self.total_comments,
            "slides_with_comments": self.slides_with_comments,
            "total_replies": self.total_replies,
            "fetch_time_ms": round(self.fetch_time_ms, 2)
        }


@dataclass 
class QuestionStats:
    """Statistics about extracted questions."""
    total_questions: int = 0
    valid_questions: int = 0
    invalid_slides: int = 0
    multi_question_slides: int = 0
    vision_extractions: int = 0
    text_extractions: int = 0
    questions_needing_review: int = 0
    avg_confidence: float = 0.0
    
    def to_dict(self) -> dict:
        return {
            "total_questions": self.total_questions,
            "valid_questions": self.valid_questions,
            "invalid_slides": self.invalid_slides,
            "multi_question_slides": self.multi_question_slides,
            "vision_extractions": self.vision_extractions,
            "text_extractions": self.text_extractions,
            "questions_needing_review": self.questions_needing_review,
            "avg_confidence": round(self.avg_confidence, 1)
        }


class StatsCollector:
    """
    Singleton collector for all statistics during a parsing run.
    
    Usage:
        stats = init_stats_collector()
        # ... do work, stats are recorded via get_stats_collector() ...
        summary = stats.finalize()
    """
    _instance: Optional['StatsCollector'] = None
    
    def __init__(self):
        self.enabled = True
        self.ai_calls: List[AICallStats] = []
        self._lock = threading.Lock()
        self.parser_stats: ParserStats = ParserStats()
        self.comment_stats: CommentStats = CommentStats()
        self.question_stats: QuestionStats = QuestionStats()
        
        self.start_time: Optional[datetime] = None
        self.end_time: Optional[datetime] = None
        self.source_file: str = ""
        
        # Cost calculation (Gemini Flash pricing as of 2024)
        self.input_cost_per_million = 0.10  # $0.10 per 1M input tokens
        self.output_cost_per_million = 0.40  # $0.40 per 1M output tokens
    
    def start(self, source_file: str = ""):
        """Start the stats collection session."""
        self.start_time = datetime.now()
        self.source_file = source_file
    
    def record_ai_call(self, 
                       response: Any,
                       model: str,
                       method: str,
                       slide_number: int,
                       latency_ms: float,
                       success: bool = True,
                       error: str = ""):
        """
        Record statistics from an AI API call.
        
        Args:
            response: The GenAI response object (has usage_metadata)
            model: Model name used
            method: "text", "vision", or "classification"
            slide_number: Which slide this was for
            latency_ms: Time taken for the call
            success: Whether the call succeeded
            error: Error message if failed
        """
        if not self.enabled:
            return
        
        stats = AICallStats(
            timestamp=datetime.now(),
            model=model,
            method=method,
            slide_number=slide_number,
            latency_ms=latency_ms,
            success=success,
            error=error
        )
        
        # Extract token counts from response if available.
        response_dump = response.model_dump() if response and hasattr(response, "model_dump") else {}
        openai_usage = response_dump.get("usage", {}) if isinstance(response_dump, dict) else {}
        if isinstance(openai_usage, dict) and openai_usage:
            stats.prompt_tokens = int(openai_usage.get("input_tokens", openai_usage.get("prompt_tokens", 0)) or 0)
            stats.completion_tokens = int(openai_usage.get("output_tokens", openai_usage.get("completion_tokens", 0)) or 0)
            stats.total_tokens = int(openai_usage.get("total_tokens", stats.prompt_tokens + stats.completion_tokens) or 0)
            details = openai_usage.get("output_tokens_details", {}) or openai_usage.get("completion_tokens_details", {})
            if isinstance(details, dict):
                stats.thinking_tokens = int(details.get("reasoning_tokens", details.get("thinking_tokens", 0)) or 0)
            stats.usage_available = stats.total_tokens > 0
        elif response and hasattr(response, 'usage_metadata'):
            usage = response.usage_metadata
            stats.prompt_tokens = getattr(usage, 'prompt_token_count', 0) or 0
            stats.completion_tokens = getattr(usage, 'candidates_token_count', 0) or 0
            stats.total_tokens = getattr(usage, 'total_token_count', 0) or 0
            stats.thinking_tokens = getattr(usage, 'thoughts_token_count', 0) or 0
            stats.usage_available = stats.total_tokens > 0
        
        with self._lock:
            self.ai_calls.append(stats)
    
    def record_parser_stats(self, slides: list):
        """Record stats from the PPTX parsing phase."""
        if not self.enabled:
            return
        
        self.parser_stats.total_slides = len(slides)
        
        for slide in slides:
            text_content = "\n".join(getattr(slide, 'texts', []))
            if text_content.strip():
                self.parser_stats.slides_with_text += 1
                self.parser_stats.total_text_characters += len(text_content)
            
            images = getattr(slide, 'images', [])
            if images:
                self.parser_stats.slides_with_images += 1
                self.parser_stats.total_images_extracted += len(images)
            
            if getattr(slide, 'speaker_notes', '').strip():
                self.parser_stats.slides_with_speaker_notes += 1
            
            if getattr(slide, 'highlighted_texts', []):
                self.parser_stats.slides_with_highlights += 1
    
    def record_comment_stats(self, comments: list, comments_by_slide: dict):
        """Record stats from Google API comment fetching."""
        if not self.enabled:
            return
        
        self.comment_stats.total_comments = len(comments)
        self.comment_stats.slides_with_comments = len(comments_by_slide)
        self.comment_stats.total_replies = sum(
            len(getattr(c, 'replies', [])) for c in comments
        )
    
    def record_question_stats(self, questions: list):
        """Record stats about extracted questions."""
        if not self.enabled:
            return
        
        self.question_stats.total_questions = len(questions)
        
        valid_questions = [q for q in questions if getattr(q, 'is_valid_question', False)]
        self.question_stats.valid_questions = len(valid_questions)
        self.question_stats.invalid_slides = len(questions) - len(valid_questions)
        
        # Count by extraction method
        for q in valid_questions:
            method = getattr(q, 'extraction_method', 'text')
            if method == 'vision':
                self.question_stats.vision_extractions += 1
            else:
                self.question_stats.text_extractions += 1
        
        # Count multi-question slides
        slide_question_counts = {}
        for q in valid_questions:
            slide_num = getattr(q, 'slide_number', 0)
            slide_question_counts[slide_num] = slide_question_counts.get(slide_num, 0) + 1
        
        self.question_stats.multi_question_slides = sum(
            1 for count in slide_question_counts.values() if count > 1
        )
        
        # Average confidence
        confidences = [getattr(q, 'confidence', 0) for q in valid_questions]
        if confidences:
            self.question_stats.avg_confidence = sum(confidences) / len(confidences)
        
        # Questions needing review
        self.question_stats.questions_needing_review = sum(
            1 for q in valid_questions if getattr(q, 'needs_review', lambda: False)()
        )
    
    def finalize(self) -> dict:
        """
        Finalize stats collection and return comprehensive summary.
        
        Returns:
            Dictionary with all collected statistics and calculated aggregates
        """
        self.end_time = datetime.now()
        
        # Calculate AI aggregate stats
        total_prompt_tokens = sum(c.prompt_tokens for c in self.ai_calls)
        total_completion_tokens = sum(c.completion_tokens for c in self.ai_calls)
        total_tokens = sum(c.total_tokens for c in self.ai_calls)
        total_thinking_tokens = sum(c.thinking_tokens for c in self.ai_calls)
        
        successful_calls = [c for c in self.ai_calls if c.success]
        failed_calls = [c for c in self.ai_calls if not c.success]
        calls_with_usage = [c for c in self.ai_calls if c.usage_available]
        
        avg_latency = 0.0
        if successful_calls:
            avg_latency = sum(c.latency_ms for c in successful_calls) / len(successful_calls)
        
        total_latency = sum(c.latency_ms for c in self.ai_calls)
        
        # Calculate estimated cost
        input_cost = (total_prompt_tokens / 1_000_000) * self.input_cost_per_million
        output_cost = (total_completion_tokens / 1_000_000) * self.output_cost_per_million
        total_cost = input_cost + output_cost
        
        # Build summary
        duration_seconds = 0
        if self.start_time and self.end_time:
            duration_seconds = (self.end_time - self.start_time).total_seconds()
        
        return {
            "meta": {
                "source_file": self.source_file,
                "start_time": self.start_time.isoformat() if self.start_time else None,
                "end_time": self.end_time.isoformat() if self.end_time else None,
                "duration_seconds": round(duration_seconds, 2),
                "generated_at": datetime.now().isoformat()
            },
            "parser": self.parser_stats.to_dict(),
            "comments": self.comment_stats.to_dict(),
            "questions": self.question_stats.to_dict(),
            "ai_summary": {
                "total_calls": len(self.ai_calls),
                "successful_calls": len(successful_calls),
                "failed_calls": len(failed_calls),
                "calls_with_usage": len(calls_with_usage),
                "usage_status": "known" if calls_with_usage or not self.ai_calls else "unknown",
                "total_prompt_tokens": total_prompt_tokens,
                "total_completion_tokens": total_completion_tokens,
                "total_tokens": total_tokens,
                "total_thinking_tokens": total_thinking_tokens,
                "avg_latency_ms": round(avg_latency, 2),
                "total_latency_ms": round(total_latency, 2),
                "calls_by_method": {
                    "text": sum(1 for c in self.ai_calls if c.method == "text"),
                    "vision": sum(1 for c in self.ai_calls if c.method == "vision"),
                    "classification": sum(1 for c in self.ai_calls if c.method == "classification")
                }
            },
            "cost_estimate": {
                "input_cost_usd": round(input_cost, 6),
                "output_cost_usd": round(output_cost, 6),
                "total_cost_usd": round(total_cost, 6),
                "usage_status": "known" if calls_with_usage or not self.ai_calls else "unknown",
                "pricing_note": f"Based on ${self.input_cost_per_million}/1M input, ${self.output_cost_per_million}/1M output tokens"
            },
            "ai_calls": [c.to_dict() for c in self.ai_calls]
        }
    
    def reset(self):
        """Reset all collected stats."""
        with self._lock:
            self.ai_calls = []
        self.parser_stats = ParserStats()
        self.comment_stats = CommentStats()
        self.question_stats = QuestionStats()
        self.start_time = None
        self.end_time = None
        self.source_file = ""


# Module-level functions for easy access
_collector: Optional[StatsCollector] = None


def init_stats_collector(enabled: bool = True) -> StatsCollector:
    """Initialize and return the global stats collector."""
    global _collector
    _collector = StatsCollector()
    _collector.enabled = enabled
    return _collector


def get_stats_collector() -> Optional[StatsCollector]:
    """Get the current stats collector instance."""
    return _collector


def reset_stats_collector():
    """Reset the global stats collector."""
    global _collector
    if _collector:
        _collector.reset()
    _collector = None
