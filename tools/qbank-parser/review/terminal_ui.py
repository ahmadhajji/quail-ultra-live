"""
Terminal Review Interface

Provides a quick, keyboard-driven interface for reviewing extracted questions.
- ENTER to confirm and move to next
- E to edit
- S to skip/flag
- Q to quit (saves progress)
"""

import json
import sys
from pathlib import Path
from typing import Optional, Callable
from dataclasses import dataclass

try:
    from rich.console import Console
    from rich.panel import Panel
    from rich.table import Table
    from rich.progress import Progress, SpinnerColumn, TextColumn
    from rich.prompt import Prompt, Confirm
    from rich.text import Text
    from rich.layout import Layout
    import readchar
    RICH_AVAILABLE = True
except ImportError:
    RICH_AVAILABLE = False

# Add parent to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))
from domain.models import ExtractedQuestion


@dataclass
class ReviewResult:
    """Result of reviewing a single question."""
    question_id: str
    slide_number: int
    question_index: int
    status: str  # approved, edited, rekeyed, rejected, skipped, quit
    edited_data: Optional[dict] = None


class TerminalReviewUI:
    """Terminal-based UI for quick question review."""
    
    def __init__(self):
        if not RICH_AVAILABLE:
            raise ImportError("rich and readchar not installed. Run: pip install rich readchar")
        
        self.console = Console()
        self.questions: list[ExtractedQuestion] = []
        self.current_index: int = 0
        self.results: list[ReviewResult] = []
        self.should_quit: bool = False
    
    def load_questions(self, questions: list[ExtractedQuestion]):
        """Load questions to review."""
        self.questions = [q for q in questions if q.is_reviewable()]
        self.current_index = 0
        self.results = []
    
    def _render_question(self, question: ExtractedQuestion) -> Panel:
        """Render a question as a rich Panel."""
        # Build the content
        content_parts = []
        
        # Question stem
        content_parts.append(f"[bold cyan]QUESTION:[/bold cyan]")
        content_parts.append(f"{question.question_stem[:500]}{'...' if len(question.question_stem) > 500 else ''}")
        content_parts.append("")
        
        # Choices
        content_parts.append("[bold cyan]CHOICES:[/bold cyan]")
        for letter, text in question.choices.items():
            if letter == question.correct_answer:
                content_parts.append(f"  [bold green]{letter}. {text} ✅[/bold green]")
            else:
                content_parts.append(f"  {letter}. {text}")
        content_parts.append("")
        
        # Explanation
        if question.explanation:
            content_parts.append("[bold cyan]EXPLANATION:[/bold cyan]")
            exp_preview = question.explanation[:200]
            if len(question.explanation) > 200:
                exp_preview += "..."
            content_parts.append(f"[dim]{exp_preview}[/dim]")
            content_parts.append("")
        
        # Flags
        if question.flags:
            content_parts.append("[bold yellow]⚠️ FLAGS:[/bold yellow]")
            for flag in question.flags:
                content_parts.append(f"  • {flag}")
            content_parts.append("")

        content_parts.append(f"[bold cyan]CLASSIFICATION:[/bold cyan] {question.classification}")
        if question.review_reasons:
            content_parts.append("[bold cyan]REVIEW REASONS:[/bold cyan]")
            for reason in question.review_reasons:
                content_parts.append(f"  • {reason}")
            content_parts.append("")

        if question.warnings:
            content_parts.append("[bold yellow]WARNINGS:[/bold yellow]")
            for warning in question.warnings:
                content_parts.append(f"  • {warning}")
            content_parts.append("")

        if question.fact_check:
            content_parts.append("[bold cyan]FACT CHECK:[/bold cyan]")
            content_parts.append(f"  Status: {question.fact_check.get('status', 'n/a')}")
            note = str(question.fact_check.get("note", "")).strip()
            if note:
                content_parts.append(f"  Note: {note}")
            proposal = str(question.proposed_correct_answer or question.fact_check.get("recommended_answer", "")).strip()
            if proposal:
                content_parts.append(f"  Proposed answer: {proposal}")
            content_parts.append("")

        if question.comments:
            content_parts.append("[bold cyan]COMMENTS:[/bold cyan]")
            for comment in question.comments[:3]:
                content_parts.append(
                    f"  • {comment.get('author', 'Unknown')}: {comment.get('content', '')[:120]}"
                )
            content_parts.append("")

        content_parts.append(
            "[dim]"
            f"Images: {len(question.images)} question / {len(question.explanation_images)} explanation"
            "[/dim]"
        )
        
        # Source
        content_parts.append(f"[dim]Answer source: {question.source_of_answer}[/dim]")
        
        content = "\n".join(content_parts)
        
        # Confidence color
        if question.confidence >= 80:
            conf_color = "green"
        elif question.confidence >= 60:
            conf_color = "yellow"
        else:
            conf_color = "red"
        
        title = (
            f"QID {question.question_id} | SLIDE {question.slide_number} of {len(self.questions)} "
            f"│ Confidence: [{conf_color}]{question.confidence}%[/{conf_color}]"
        )
        
        return Panel(content, title=title, border_style="blue")
    
    def _render_controls(self) -> Panel:
        """Render the control instructions."""
        controls = Table.grid(padding=1)
        controls.add_row(
            "[bold green]ENTER[/bold green] Approve",
            "[bold yellow]E[/bold yellow] Edit",
            "[bold cyan]R[/bold cyan] Rekey",
            "[bold red]X[/bold red] Reject",
            "[bold red]S[/bold red] Skip",
            "[bold magenta]Q[/bold magenta] Quit & Save"
        )
        return Panel(controls, title="Controls", border_style="dim")
    
    def _render_progress(self) -> str:
        """Render progress bar."""
        approved = sum(1 for r in self.results if r.status in {'approved', 'edited', 'rekeyed'})
        rejected = sum(1 for r in self.results if r.status == 'rejected')
        skipped = sum(1 for r in self.results if r.status == 'skipped')
        remaining = len(self.questions) - len(self.results)
        
        return (
            f"Progress: {len(self.results)}/{len(self.questions)} │ "
            f"✅ {approved} approved │ ❌ {rejected} rejected │ ⏭️ {skipped} skipped │ 📋 {remaining} remaining"
        )
    
    def _edit_question(self, question: ExtractedQuestion) -> dict:
        """Interactive edit of a question."""
        self.console.clear()
        self.console.print("[bold]Edit Question[/bold]")
        self.console.print()
        
        edited = question.to_dict()
        
        # Edit question stem
        self.console.print("[cyan]Current question stem:[/cyan]")
        self.console.print(question.question_stem[:300] + "..." if len(question.question_stem) > 300 else question.question_stem)
        if Confirm.ask("Edit question stem?", default=False):
            edited["question_stem"] = Prompt.ask("New question stem")
        
        # Edit correct answer
        self.console.print()
        self.console.print(f"[cyan]Current correct answer:[/cyan] {question.correct_answer}")
        self.console.print("Choices:", list(question.choices.keys()))
        if Confirm.ask("Change correct answer?", default=False):
            edited["correct_answer"] = Prompt.ask("New correct answer (letter)", choices=list(question.choices.keys()))
            edited["correct_answer_text"] = question.choices.get(edited["correct_answer"], "")
        
        # Confirm confidence
        edited["confidence"] = 100  # Manual review = high confidence
        edited["flags"] = []  # Clear flags after review
        edited["classification"] = "accepted"
        edited["review_status"] = "edited"
        
        return edited

    def _rekey_question(self, question: ExtractedQuestion) -> dict:
        """Interactive answer-only correction."""
        self.console.clear()
        self.console.print("[bold]Rekey Question[/bold]")
        self.console.print(f"[cyan]Current correct answer:[/cyan] {question.correct_answer}")
        self.console.print("Choices:", list(question.choices.keys()))
        new_answer = Prompt.ask("New correct answer (letter)", choices=list(question.choices.keys()))
        return {
            "correct_answer": new_answer,
            "correct_answer_text": question.choices.get(new_answer, ""),
            "classification": "accepted",
            "review_status": "rekeyed",
            "review_reasons": [],
            "flags": [],
            "confidence": 100,
        }
    
    def review_single(self, question: ExtractedQuestion) -> ReviewResult:
        """Review a single question and get user input."""
        self.console.clear()
        
        # Show progress
        self.console.print(self._render_progress())
        self.console.print()
        
        # Show question
        self.console.print(self._render_question(question))
        self.console.print()
        
        # Show controls
        self.console.print(self._render_controls())
        
        # Wait for key press
        self.console.print("\n[dim]Press a key...[/dim]")
        
        key = readchar.readkey()
        
        if key == readchar.key.ENTER or key == '\r' or key == '\n':
            return ReviewResult(
                question_id=question.question_id,
                slide_number=question.slide_number,
                question_index=question.question_index,
                status='approved',
                edited_data={"classification": "accepted", "review_status": "approved"}
            )
        elif key.lower() == 'e':
            edited = self._edit_question(question)
            return ReviewResult(
                question_id=question.question_id,
                slide_number=question.slide_number,
                question_index=question.question_index,
                status='edited',
                edited_data=edited
            )
        elif key.lower() == 'r':
            edited = self._rekey_question(question)
            return ReviewResult(
                question_id=question.question_id,
                slide_number=question.slide_number,
                question_index=question.question_index,
                status='rekeyed',
                edited_data=edited,
            )
        elif key.lower() == 'x':
            return ReviewResult(
                question_id=question.question_id,
                slide_number=question.slide_number,
                question_index=question.question_index,
                status='rejected',
                edited_data={"classification": "rejected", "review_status": "rejected"},
            )
        elif key.lower() == 's':
            return ReviewResult(
                question_id=question.question_id,
                slide_number=question.slide_number,
                question_index=question.question_index,
                status='skipped'
            )
        elif key.lower() == 'q':
            self.should_quit = True
            return ReviewResult(
                question_id=question.question_id,
                slide_number=question.slide_number,
                question_index=question.question_index,
                status='quit'
            )
        else:
            # Unknown key, treat as confirm
            return ReviewResult(
                question_id=question.question_id,
                slide_number=question.slide_number,
                question_index=question.question_index,
                status='approved',
                edited_data={"classification": "accepted", "review_status": "approved"},
            )
    
    def run_review(self, questions: list[ExtractedQuestion], 
                   save_callback: Optional[Callable] = None) -> list[ReviewResult]:
        """
        Run the full review session.
        
        Args:
            questions: List of extracted questions to review
            save_callback: Optional function to call after each review (for saving progress)
        
        Returns:
            List of ReviewResult objects
        """
        self.load_questions(questions)
        
        if not self.questions:
            self.console.print("[yellow]No questions to review![/yellow]")
            return []
        
        self.console.print(f"[bold]Starting review of {len(self.questions)} questions[/bold]")
        self.console.print("[dim]Press any key to start...[/dim]")
        readchar.readkey()
        
        for i, question in enumerate(self.questions):
            self.current_index = i
            result = self.review_single(question)
            self.results.append(result)
            
            if save_callback:
                save_callback(self.results)
            
            if self.should_quit:
                break
        
        # Final summary
        self.console.clear()
        self.console.print("[bold green]Review Complete![/bold green]")
        self.console.print(self._render_progress())
        
        return self.results


def review_questions_simple(questions: list[ExtractedQuestion]) -> list[ReviewResult]:
    """
    Simple non-interactive review for testing.
    Auto-confirms all questions with confidence > 70.
    """
    results = []
    for q in questions:
        if q.is_reviewable():
            if q.classification == "accepted":
                results.append(ReviewResult(
                    question_id=q.question_id,
                    slide_number=q.slide_number,
                    question_index=q.question_index,
                    status='approved',
                    edited_data={"classification": "accepted", "review_status": "approved"},
                ))
            else:
                results.append(ReviewResult(
                    question_id=q.question_id,
                    slide_number=q.slide_number,
                    question_index=q.question_index,
                    status='skipped'
                ))
    return results


if __name__ == "__main__":
    # Test the UI with dummy data
    from domain.models import ExtractedQuestion
    
    test_questions = [
        ExtractedQuestion(
            slide_number=1,
            classification="accepted",
            question_stem="A 65-year-old man with COPD and hypertension presents with elevated BP. Which medication is best?",
            choices={"A": "Beta blockers", "B": "ACE inhibitors", "C": "Calcium channel blockers", "D": "Thiazides"},
            correct_answer="B",
            correct_answer_text="ACE inhibitors",
            confidence=85,
            explanation="ACE-I is preferred due to renoprotective effects.",
            source_of_answer="highlighted"
        ),
        ExtractedQuestion(
            slide_number=2,
            classification="needs_review",
            question_stem="A 2-year-old child is brought for evaluation. What milestone is expected?",
            choices={"A": "Walks alone", "B": "Says 2-word phrases", "C": "Rides tricycle", "D": "Copies circle"},
            correct_answer="B",
            correct_answer_text="Says 2-word phrases",
            confidence=60,
            flags=["Confidence below threshold"],
            source_of_answer="inferred"
        ),
    ]
    
    ui = TerminalReviewUI()
    results = ui.run_review(test_questions)
    
    print("\nResults:")
    for r in results:
        print(f"  Slide {r.slide_number}: {r.status}")
