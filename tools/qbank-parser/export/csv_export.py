"""
CSV/JSON Export Module

Exports extracted and reviewed questions to structured formats
for further processing or archival.
"""

import csv
from pathlib import Path
from datetime import datetime
from typing import Optional

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))
from domain.models import ExtractedQuestion
from review.terminal_ui import ReviewResult
from storage.run_repository import RunRepository
from utils.question_keys import question_key, question_key_from_question, question_key_from_review_result


_RUN_REPOSITORY = RunRepository()


def _question_key_from_parts(slide_number: int, question_index: int, question_id: str | None = None) -> str:
    """Build a stable key for a question identity across the pipeline."""
    return question_key(slide_number=slide_number, question_index=question_index, question_id=question_id)


def _question_key_from_question(question: ExtractedQuestion) -> str:
    """Build stable question key from an ExtractedQuestion instance."""
    return question_key_from_question(question)


def _question_key_from_result(result: ReviewResult) -> str:
    """Build stable question key from a ReviewResult instance."""
    return question_key_from_review_result(result)


def export_to_csv(questions: list[ExtractedQuestion],
                  output_path: str | Path,
                  review_results: Optional[list[ReviewResult]] = None) -> Path:
    """
    Export questions to CSV format.
    
    Args:
        questions: List of extracted questions
        output_path: Where to save the CSV
        review_results: Optional review results to include status
    
    Returns:
        Path to created CSV file
    """
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    # Create review status mapping
    review_status = {}
    if review_results:
        for r in review_results:
            review_status[_question_key_from_result(r)] = r.status
    
    fieldnames = [
        'slide_number',
        'question_id',
        'question_index',
        'variant_label',
        'classification',
        'review_status',
        'question_stem',
        'choice_a',
        'choice_b',
        'choice_c',
        'choice_d',
        'choice_e',
        'correct_answer',
        'correct_answer_text',
        'confidence',
        'explanation',
        'source_of_answer',
        'extraction_method',
        'has_images',
        'flags',
        'review_reasons',
        'approved_for_formatting',
    ]
    
    with open(output_path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        
        for q in questions:
            # Get question_id - use attribute if available, otherwise construct
            question_id = getattr(q, 'question_id', '') or str(q.slide_number)
            question_index = getattr(q, 'question_index', 1)
            variant_label = getattr(q, 'variant_label', '')
            extraction_method = getattr(q, 'extraction_method', 'text')
            images = getattr(q, 'images', [])
            resolved_review_status = review_status.get(
                _question_key_from_question(q),
                getattr(q, 'review_status', 'pending'),
            )
            
            row = {
                'slide_number': q.slide_number,
                'question_id': question_id,
                'question_index': question_index,
                'variant_label': variant_label,
                'classification': getattr(q, 'classification', 'accepted'),
                'review_status': resolved_review_status,
                'question_stem': q.question_stem,
                'choice_a': q.choices.get('A', ''),
                'choice_b': q.choices.get('B', ''),
                'choice_c': q.choices.get('C', ''),
                'choice_d': q.choices.get('D', ''),
                'choice_e': q.choices.get('E', ''),
                'correct_answer': q.correct_answer,
                'correct_answer_text': q.correct_answer_text,
                'confidence': q.confidence,
                'explanation': q.explanation,
                'source_of_answer': q.source_of_answer,
                'extraction_method': extraction_method,
                'has_images': 'Yes' if images else 'No',
                'flags': '; '.join(q.flags) if q.flags else '',
                'review_reasons': '; '.join(getattr(q, 'review_reasons', [])),
                'approved_for_formatting': 'Yes' if q.is_approved_for_formatting() else 'No',
            }
            writer.writerow(row)
    
    return output_path


def export_to_json(questions: list[ExtractedQuestion],
                   output_path: str | Path,
                   review_results: Optional[list[ReviewResult]] = None,
                   pretty: bool = True) -> Path:
    """
    Export questions to JSON format.
    
    Args:
        questions: List of extracted questions
        output_path: Where to save the JSON
        review_results: Optional review results
        pretty: Whether to format JSON with indentation
    
    Returns:
        Path to created JSON file
    """
    output_path = Path(output_path)
    
    # Create review status mapping
    review_status = {}
    edited_data = {}
    if review_results:
        for r in review_results:
            question_key = _question_key_from_result(r)
            review_status[question_key] = r.status
            if r.edited_data:
                edited_data[question_key] = r.edited_data
    
    output_data = {
        "export_date": datetime.now().isoformat(),
        "total_slides": len(
            {
                int(getattr(q, "slide_number", 0))
                for q in questions
                if int(getattr(q, "slide_number", 0)) > 0
            }
        ),
        "valid_questions": sum(1 for q in questions if q.classification == "accepted"),
        "question_counts": {
            "accepted": sum(1 for q in questions if q.classification == "accepted"),
            "needs_review": sum(1 for q in questions if q.classification == "needs_review"),
            "rejected": sum(1 for q in questions if q.classification == "rejected"),
            "error": sum(1 for q in questions if q.classification == "error"),
        },
        "questions": []
    }
    
    for q in questions:
        q_data = q.to_dict()
        question_key = _question_key_from_question(q)
        q_data['review_status'] = review_status.get(question_key, q_data.get('review_status', 'pending'))
        
        # Apply edits if any
        if question_key in edited_data:
            q_data.update(edited_data[question_key])
        
        output_data["questions"].append(q_data)
    
    return _RUN_REPOSITORY.write_json(
        output_path,
        output_data,
        pretty=pretty,
        atomic=True,
        ensure_ascii=False,
    )


def load_from_json(json_path: str | Path) -> list[ExtractedQuestion]:
    """
    Load questions from a previously exported JSON file.
    
    Useful for resuming work or reprocessing.
    """
    return _RUN_REPOSITORY.load_extracted_questions(json_path)


def get_confirmed_questions(questions: list[ExtractedQuestion],
                           review_results: list[ReviewResult]) -> list[ExtractedQuestion]:
    """
    Get only the questions that were confirmed or edited during review.
    """
    confirmed_questions = set()
    edited_data = {}
    
    for r in review_results:
        if r.status in ('approved', 'edited', 'rekeyed', 'confirmed'):
            question_key = _question_key_from_result(r)
            confirmed_questions.add(question_key)
            if r.edited_data:
                edited_data[question_key] = r.edited_data
    
    result = []
    for q in questions:
        question_key = _question_key_from_question(q)
        if question_key in confirmed_questions:
            # Apply any edits
            if question_key in edited_data:
                edit = edited_data[question_key]
                q.question_stem = edit.get('question_stem', q.question_stem)
                q.correct_answer = edit.get('correct_answer', q.correct_answer)
                q.correct_answer_text = edit.get('correct_answer_text', q.correct_answer_text)
                q.confidence = edit.get('confidence', 100)
                q.flags = edit.get('flags', [])
                q.classification = edit.get('classification', q.classification)
                q.review_status = edit.get('review_status', q.review_status)
            result.append(q)
    
    return result
