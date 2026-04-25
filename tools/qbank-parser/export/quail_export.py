"""Quail question bank export utilities."""

from __future__ import annotations

import html
import json
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from utils.image_filters import is_placeholder_image_for_export

PANE_FILES = ("lab_values.html", "calculator.html", "notes.html")
QUESTION_META_FILE = "question-meta.json"


@dataclass
class QuailExportSummary:
    """Summary produced by a Quail export run."""

    source_json: Path
    output_dir: Path
    mode: str
    questions_added: int
    total_questions: int
    html_files_created: int
    total_source_images: int
    images_copied: int
    images_skipped: int

    def to_dict(self) -> dict:
        return {
            "source_json": str(self.source_json),
            "output_dir": str(self.output_dir),
            "mode": self.mode,
            "questions_added": self.questions_added,
            "total_questions": self.total_questions,
            "html_files_created": self.html_files_created,
            "total_source_images": self.total_source_images,
            "images_copied": self.images_copied,
            "images_skipped": self.images_skipped,
        }


def _default_logger(message: str) -> None:
    print(message)


def is_white_image(image_path: Path) -> bool:
    """Return True if image appears to be an empty placeholder."""
    return is_placeholder_image_for_export(image_path)


def escape_html(text: str) -> str:
    """Escape HTML and convert line breaks for rendering."""
    if not text:
        return ""
    return html.escape(text).replace("\n", "<br>\n")


def generate_question_html(question: dict, valid_images: list[str]) -> str:
    """Create the Quail question HTML payload."""
    lines = [
        "<!DOCTYPE html>",
        "<html><head><meta charset=\"UTF-8\"></head><body>",
        f"<p>{escape_html(str(question.get('question_stem', '')))}</p>",
    ]

    question_text = str(question.get("question", ""))
    if question_text and question_text != str(question.get("question_stem", "")):
        lines.append(f"<p><strong>{escape_html(question_text)}</strong></p>")

    for image_name in valid_images:
        lines.append(f'<p><img src="./{image_name}"></p>')

    choices = question.get("choices", {}) if isinstance(question.get("choices", {}), dict) else {}
    lines.append("<p>")
    for letter in sorted(choices.keys()):
        lines.append(f"{letter}) {escape_html(str(choices[letter]))}<br>")
    lines.append("</p>")
    lines.append("</body></html>")
    return "\n".join(lines)


def generate_solution_html(question: dict, valid_images: list[str]) -> str:
    """Create the Quail solution HTML payload."""
    lines = [
        "<!DOCTYPE html>",
        "<html><head><meta charset=\"UTF-8\"></head><body>",
        f"<p><strong>Correct Answer: {escape_html(str(question.get('correct_answer', '')))}</strong></p>",
    ]

    explanation = escape_html(str(question.get("correct_answer_explanation", "")))
    if explanation:
        lines.append(f"<p><strong>Explanation:</strong><br>{explanation}</p>")

    for image_name in valid_images:
        lines.append(f'<p><img src="./{image_name}"></p>')

    incorrect = question.get("incorrect_explanations", {})
    if isinstance(incorrect, dict) and incorrect:
        lines.append("<p><strong>Why other answers are incorrect:</strong></p>")
        lines.append("<ul>")
        for letter in sorted(incorrect.keys()):
            text = escape_html(str(incorrect[letter]))
            if text:
                lines.append(f"<li><strong>{letter}:</strong> {text}</li>")
        lines.append("</ul>")

    objective = escape_html(str(question.get("educational_objective", "")))
    if objective:
        lines.append(f"<p><strong>Educational Objective:</strong><br>{objective}</p>")

    lines.append("</body></html>")
    return "\n".join(lines)


def resolve_image_path(image_value: str, images_dir: Path, source_json_dir: Path) -> Path | None:
    """Resolve an image path from absolute/relative references."""
    raw_path = Path(image_value)

    candidates = [raw_path]
    if not raw_path.is_absolute():
        candidates.append(source_json_dir / raw_path)
    candidates.append(images_dir / raw_path.name)

    for path in candidates:
        if path.exists() and path.is_file():
            return path.resolve()
    return None


def process_images(
    image_values: list[str],
    question_num: str,
    output_dir: Path,
    images_dir: Path,
    source_json_dir: Path,
    logger: Callable[[str], None],
    name_prefix: str,
) -> list[str]:
    """Copy valid images to Quail naming and return new filenames."""
    valid_images: list[str] = []
    if not isinstance(image_values, list):
        return valid_images

    image_counter = 1
    for image_value in image_values:
        image_path = resolve_image_path(str(image_value), images_dir, source_json_dir)
        if image_path is None:
            logger(f"  Warning: Image not found: {image_value}")
            continue

        if is_white_image(image_path):
            logger(f"  Skipping white/placeholder image: {image_path.name}")
            continue

        new_name = f"{question_num}-{name_prefix}-{image_counter}.png"
        shutil.copy2(image_path, output_dir / new_name)
        valid_images.append(new_name)
        logger(f"  Copied valid image: {image_path.name} -> {new_name}")
        image_counter += 1

    return valid_images


def get_next_question_number(output_dir: Path) -> int:
    """Return the next question number for append mode."""
    max_num = 0
    for file_path in output_dir.glob("*-q.html"):
        try:
            max_num = max(max_num, int(file_path.stem.split("-")[0]))
        except ValueError:
            continue
    return max_num + 1


def load_existing_metadata(output_dir: Path) -> tuple[dict, dict, dict]:
    """Load existing choices/index/question metadata if present."""
    choices = {}
    index = {}
    question_meta = {}

    choices_file = output_dir / "choices.json"
    index_file = output_dir / "index.json"
    question_meta_file = output_dir / QUESTION_META_FILE

    if choices_file.exists():
        choices = json.loads(choices_file.read_text(encoding="utf-8"))
    if index_file.exists():
        index = json.loads(index_file.read_text(encoding="utf-8"))
    if question_meta_file.exists():
        question_meta = json.loads(question_meta_file.read_text(encoding="utf-8"))

    return choices, index, question_meta


def reset_output_for_fresh_export(output_dir: Path) -> None:
    """Remove generated Quail artifacts when running in fresh mode."""
    file_patterns = ["*-q.html", "*-s.html", "*-img-*.png"]
    for pattern in file_patterns:
        for file_path in output_dir.glob(pattern):
            file_path.unlink(missing_ok=True)

    for filename in (
        "choices.json",
        "index.json",
        "tagnames.json",
        "groups.json",
        "panes.json",
        QUESTION_META_FILE,
        *PANE_FILES,
    ):
        (output_dir / filename).unlink(missing_ok=True)
    shutil.rmtree(output_dir / "source-slides", ignore_errors=True)


def copy_pane_templates(templates_dir: Path, output_dir: Path, logger: Callable[[str], None]) -> None:
    """Copy static pane HTML files expected by Quail."""
    for pane_file in PANE_FILES:
        source = templates_dir / pane_file
        if source.exists():
            shutil.copy2(source, output_dir / pane_file)
            logger(f"  Copied: {pane_file}")
        else:
            logger(f"  Warning: Template not found: {pane_file}")


def _copy_source_slide_asset(
    *,
    question: dict,
    output_dir: Path,
    source_json_dir: Path,
    logger: Callable[[str], None],
) -> dict:
    """Copy source slide image to Ultra Live convention when present."""
    source_slide_path = str(question.get("source_slide_path", "") or "").strip()
    deck_id = str(question.get("deck_id", "") or "").strip()
    slide_number = int(question.get("original_slide_number", question.get("slide_number", 0)) or 0)
    if not source_slide_path or not deck_id or slide_number <= 0:
        return {"asset_path": "", "expandable": False}

    resolved = resolve_image_path(source_slide_path, source_json_dir, source_json_dir)
    if resolved is None:
        logger(f"  Warning: Source slide image not found: {source_slide_path}")
        return {"asset_path": "", "expandable": False}

    target_dir = output_dir / "source-slides"
    target_dir.mkdir(parents=True, exist_ok=True)
    target_name = f"{deck_id}__slide_{slide_number}.png"
    shutil.copy2(resolved, target_dir / target_name)
    return {"asset_path": f"source-slides/{target_name}", "expandable": True}


def export_quail_qbank(
    source_json: str | Path,
    output_dir: str | Path,
    images_dir: str | Path | None = None,
    append: bool = False,
    templates_dir: str | Path | None = None,
    logger: Callable[[str], None] | None = None,
) -> QuailExportSummary:
    """Convert USMLE-formatted JSON into a Quail-ready question bank."""
    logger_fn = logger or _default_logger

    source_path = Path(source_json).resolve()
    if not source_path.exists():
        raise FileNotFoundError(f"Source JSON file not found: {source_path}")

    target_dir = Path(output_dir).resolve()
    target_dir.mkdir(parents=True, exist_ok=True)

    if images_dir is None:
        inferred_images_dir = source_path.parent / "extracted_images"
        images_path = inferred_images_dir if inferred_images_dir.exists() else source_path.parent
    else:
        images_path = Path(images_dir).resolve()

    if templates_dir is None:
        default_templates = Path(__file__).resolve().parent.parent / "templates"
        templates_path = default_templates
    else:
        templates_path = Path(templates_dir).resolve()

    logger_fn("=" * 60)
    logger_fn("USMLE to Quail Converter")
    logger_fn("=" * 60)
    logger_fn(f"\nSource JSON:      {source_path}")
    logger_fn(f"Images directory: {images_path}")
    logger_fn(f"Output directory: {target_dir}")
    logger_fn(f"Mode:             {'APPEND' if append else 'FRESH'}")

    data = json.loads(source_path.read_text(encoding="utf-8"))
    questions = data.get("questions", [])
    if not isinstance(questions, list):
        raise ValueError("Input JSON must contain a top-level 'questions' array.")

    blocking: list[str] = []
    for question in questions:
        if not isinstance(question, dict):
            continue
        question_id = str(question.get("question_id", "") or "unknown")
        review_status = str(question.get("review_status", "") or "").strip()
        extraction_classification = str(question.get("extraction_classification", "") or "").strip()
        fact_check = question.get("fact_check", {})
        fact_check_status = str(fact_check.get("status", "") or "").strip() if isinstance(fact_check, dict) else ""
        if review_status not in {"approved", "edited", "rekeyed"}:
            blocking.append(f"{question_id}: review_status={review_status or 'missing'}")
        elif extraction_classification and extraction_classification != "accepted":
            blocking.append(f"{question_id}: extraction_classification={extraction_classification}")
        elif fact_check_status in {"disputed", "unresolved"}:
            blocking.append(f"{question_id}: fact_check={fact_check_status}")

    if blocking:
        raise ValueError(
            "Quail export blocked because unresolved or disputed items remain: "
            + "; ".join(blocking[:10])
        )

    logger_fn(f"\nFound {len(questions)} questions")

    if append:
        start_num = get_next_question_number(target_dir)
        choices_data, index_data, question_meta_data = load_existing_metadata(target_dir)
        logger_fn(f"\nAppending mode: Starting at question {start_num:03d}")
        logger_fn(f"Existing questions: {start_num - 1}")
    else:
        reset_output_for_fresh_export(target_dir)
        start_num = 1
        choices_data = {}
        index_data = {}
        question_meta_data = {}

    tagnames = {"tagnames": {"0": "Rotation", "1": "Topic"}}
    panes = {
        "Lab Values": {"file": "lab_values.html", "prefs": "width=500,height=700"},
        "Calculator": {"file": "calculator.html", "prefs": "width=320,height=550"},
        "Notes": {"file": "notes.html", "prefs": "width=400,height=500"},
    }

    stats = {
        "questions_processed": 0,
        "images_copied": 0,
        "images_skipped": 0,
        "total_source_images": 0,
    }

    logger_fn("\n" + "-" * 60)
    logger_fn("Processing questions...")
    logger_fn("-" * 60)

    question_numbers = [f"{start_num + index:03d}" for index in range(len(questions))]
    original_id_to_qid: dict[str, str] = {}
    for qid, question in zip(question_numbers, questions):
        original_question_id = str(question.get("question_id", "") or "").strip()
        if original_question_id:
            original_id_to_qid[original_question_id] = qid

    for index, question in enumerate(questions):
        question_num = question_numbers[index]
        original_id = question.get("question_id", index + 1)
        logger_fn(f"\n[{question_num}] Processing question (original ID: {original_id})")

        question_images = question.get("images", [])
        if not isinstance(question_images, list):
            question_images = []
        explanation_images = question.get("explanation_images", [])
        if not isinstance(explanation_images, list):
            explanation_images = []
        stats["total_source_images"] += len(question_images) + len(explanation_images)

        valid_question_images = process_images(
            image_values=question_images,
            question_num=question_num,
            output_dir=target_dir,
            images_dir=images_path,
            source_json_dir=source_path.parent,
            logger=logger_fn,
            name_prefix="img",
        )
        valid_explanation_images = process_images(
            image_values=explanation_images,
            question_num=question_num,
            output_dir=target_dir,
            images_dir=images_path,
            source_json_dir=source_path.parent,
            logger=logger_fn,
            name_prefix="sol-img",
        )
        stats["images_copied"] += len(valid_question_images) + len(valid_explanation_images)
        stats["images_skipped"] += (
            len(question_images)
            - len(valid_question_images)
            + len(explanation_images)
            - len(valid_explanation_images)
        )

        (target_dir / f"{question_num}-q.html").write_text(
            generate_question_html(question, valid_question_images),
            encoding="utf-8",
        )
        (target_dir / f"{question_num}-s.html").write_text(
            generate_solution_html(question, valid_explanation_images),
            encoding="utf-8",
        )

        choices = question.get("choices", {})
        if not isinstance(choices, dict):
            choices = {}
        choice_presentation = question.get("choice_presentation", {})
        display_order = []
        if isinstance(choice_presentation, dict):
            raw_display_order = choice_presentation.get("display_order", [])
            if isinstance(raw_display_order, list):
                display_order = [str(item) for item in raw_display_order if str(item) in choices]
        if not display_order:
            display_order = list(choices.keys())

        choices_data[question_num] = {
            "options": display_order,
            "correct": str(question.get("correct_answer", "")),
        }

        tags = question.get("tags", {})
        if not isinstance(tags, dict):
            tags = {}
        topic = tags.get("topic")
        if not topic:
            # Backward compatibility with legacy schema.
            topic = tags.get("system") or tags.get("discipline") or "Untagged"
        index_data[question_num] = {
            "0": str(tags.get("rotation", "Untagged")),
            "1": str(topic),
        }

        related_qids = []
        raw_related = question.get("related_question_ids", [])
        if isinstance(raw_related, list):
            related_qids = [
                original_id_to_qid[related_id]
                for related_id in raw_related
                if str(related_id) in original_id_to_qid and original_id_to_qid[str(related_id)] != question_num
            ]

        source_slide = _copy_source_slide_asset(
            question=question,
            output_dir=target_dir,
            source_json_dir=source_path.parent,
            logger=logger_fn,
        )

        raw_fact_check = question.get("fact_check", {})
        if not isinstance(raw_fact_check, dict):
            raw_fact_check = {}
        fact_check_sources = raw_fact_check.get("sources", [])
        if not isinstance(fact_check_sources, list):
            fact_check_sources = []
        if not fact_check_sources:
            grounding_sources = question.get("grounding_sources", [])
            if isinstance(grounding_sources, list):
                fact_check_sources = [str(item) for item in grounding_sources if str(item).strip()]

        question_meta_data[question_num] = {
            "source": {
                "deck_id": str(question.get("deck_id", "") or ""),
                "slide_number": int(question.get("original_slide_number", question.get("slide_number", 0)) or 0),
                "question_index": int(question.get("original_question_index", question.get("question_index", 1)) or 1),
                "question_id": str(question.get("question_id", "") or ""),
            },
            "adjudication": {
                "extraction_classification": str(question.get("extraction_classification", "") or ""),
                "review_status": str(question.get("review_status", "") or ""),
                "review_reasons": (
                    question.get("review_reasons", []) if isinstance(question.get("review_reasons", []), list) else []
                ),
                "validation": question.get("validation", {}) if isinstance(question.get("validation", {}), dict) else {},
            },
            "source_group_id": str(question.get("source_group_id", "") or ""),
            "source_slide": source_slide,
            "slide_consensus": {
                "status": str(question.get("slide_consensus_status", "") or "")
            },
            "fact_check": {
                "status": str(raw_fact_check.get("status", "") or ""),
                "note": str(raw_fact_check.get("note", "") or ""),
                "sources": fact_check_sources,
                "model": str(raw_fact_check.get("model", "") or ""),
            },
            "choice_text_by_letter": question.get("choice_text_by_letter", choices),
            "choice_presentation": {
                "shuffle_allowed": True,
                "display_order": display_order,
            },
            "warnings": question.get("warnings", []) if isinstance(question.get("warnings", []), list) else [],
            "related_qids": related_qids,
            "dedupe_fingerprint": str(question.get("dedupe_fingerprint", "") or ""),
        }

        stats["questions_processed"] += 1

    logger_fn("\n" + "-" * 60)
    logger_fn("Writing metadata files...")
    logger_fn("-" * 60)

    (target_dir / "choices.json").write_text(
        json.dumps(choices_data, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    logger_fn(f"  Updated: choices.json ({len(choices_data)} questions)")

    (target_dir / "tagnames.json").write_text(
        json.dumps(tagnames, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    logger_fn("  Updated: tagnames.json")

    (target_dir / "index.json").write_text(
        json.dumps(index_data, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    logger_fn(f"  Updated: index.json ({len(index_data)} questions)")

    (target_dir / "groups.json").write_text("{}\n", encoding="utf-8")
    logger_fn("  Updated: groups.json")

    (target_dir / "panes.json").write_text(
        json.dumps(panes, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    logger_fn("  Updated: panes.json (3 study tools)")

    (target_dir / QUESTION_META_FILE).write_text(
        json.dumps(question_meta_data, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    logger_fn(f"  Updated: {QUESTION_META_FILE} ({len(question_meta_data)} questions)")

    copy_pane_templates(templates_path, target_dir, logger_fn)

    logger_fn("\n" + "=" * 60)
    logger_fn("CONVERSION COMPLETE")
    logger_fn("=" * 60)
    logger_fn(f"  Questions added:       {stats['questions_processed']}")
    logger_fn(f"  Total questions now:   {len(choices_data)}")
    logger_fn(f"  HTML files created:    {stats['questions_processed'] * 2}")
    logger_fn(f"  Total source images:   {stats['total_source_images']}")
    logger_fn(f"  Valid images copied:   {stats['images_copied']}")
    logger_fn(f"  Placeholder filtered:  {stats['images_skipped']}")
    logger_fn(f"\nOutput folder: {target_dir}")

    return QuailExportSummary(
        source_json=source_path,
        output_dir=target_dir,
        mode="append" if append else "fresh",
        questions_added=stats["questions_processed"],
        total_questions=len(choices_data),
        html_files_created=stats["questions_processed"] * 2,
        total_source_images=stats["total_source_images"],
        images_copied=stats["images_copied"],
        images_skipped=stats["images_skipped"],
    )


__all__ = [
    "QuailExportSummary",
    "export_quail_qbank",
    "is_white_image",
    "generate_question_html",
    "generate_solution_html",
]
