"""Local repair utilities for legacy flat Quail exports."""

from __future__ import annotations

import json
import re
import shutil
from dataclasses import dataclass, field
from datetime import datetime
from difflib import SequenceMatcher
from html import unescape
from pathlib import Path
from typing import Callable

_IMG_SRC_PATTERN = re.compile(r'<img\b[^>]*src="\./([^"]+)"', re.IGNORECASE)
_CHOICE_PATTERN = re.compile(r"([A-E])\)\s*(.*?)<br>", re.IGNORECASE | re.DOTALL)
_TAG_PATTERN = re.compile(r"<[^>]+>")
_WHITESPACE_PATTERN = re.compile(r"\s+")
_OPTION_MARKER_PATTERN = re.compile(r"(?mi)^\s*[A-E][\)\.\:-]\s*")
_ANSWER_CUE_PATTERNS = (
    re.compile(r"\bcorrect answer\b", re.IGNORECASE),
    re.compile(r"\banswer\s*[:=-]", re.IGNORECASE),
    re.compile(r"\banswer is\b", re.IGNORECASE),
    re.compile(r"\bbest answer\b", re.IGNORECASE),
    re.compile(r"\bdiagnosis\s*[:=-]", re.IGNORECASE),
    re.compile(r"\bmanagement\s*[:=-]", re.IGNORECASE),
    re.compile(r"\bexplanation\b", re.IGNORECASE),
)
_EXPLANATION_HINTS = {
    "because",
    "therefore",
    "consistent",
    "supports",
    "suggests",
    "indicates",
    "due",
    "caused",
    "treatment",
    "management",
    "diagnosis",
    "risk",
}


@dataclass
class ImageDecision:
    """Classification outcome for a single question image."""

    destination: str
    score: int
    stem_score: int
    rule_hits: list[str] = field(default_factory=list)
    ocr_excerpt: str = ""

    def to_dict(self) -> dict:
        return {
            "destination": self.destination,
            "score": self.score,
            "stem_score": self.stem_score,
            "rule_hits": self.rule_hits,
            "ocr_excerpt": self.ocr_excerpt,
        }


@dataclass
class QuailRepairSummary:
    """Summary produced by a Quail repair run."""

    source_dir: Path
    output_dir: Path
    dry_run: bool
    questions_scanned: int = 0
    images_scanned: int = 0
    images_moved: int = 0
    images_kept: int = 0
    audit_entries: list[dict] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "source_dir": str(self.source_dir),
            "output_dir": str(self.output_dir),
            "dry_run": self.dry_run,
            "questions_scanned": self.questions_scanned,
            "images_scanned": self.images_scanned,
            "images_moved": self.images_moved,
            "images_kept": self.images_kept,
            "audit_entries": self.audit_entries,
        }


def _default_logger(message: str) -> None:
    print(message)


def default_repair_output_dir(source_dir: str | Path, now: datetime | None = None) -> Path:
    """Return the default timestamped temp output path for a repair run."""
    source_path = Path(source_dir).resolve()
    timestamp = (now or datetime.now()).strftime("%Y%m%d-%H%M%S")
    return Path("/tmp/qbank-parser-repairs") / f"{source_path.name}-adjusted-{timestamp}"


def _normalize_text(value: str) -> str:
    cleaned = re.sub(r"[^a-z0-9]+", " ", (value or "").lower())
    return _WHITESPACE_PATTERN.sub(" ", cleaned).strip()


def _strip_tags(fragment: str) -> str:
    text = _TAG_PATTERN.sub(" ", fragment or "")
    return _WHITESPACE_PATTERN.sub(" ", unescape(text)).strip()


def _tokenize(value: str) -> list[str]:
    return [token for token in _normalize_text(value).split() if token]


def _token_overlap_ratio(left: str, right: str) -> float:
    left_tokens = set(_tokenize(left))
    right_tokens = set(_tokenize(right))
    if not left_tokens or not right_tokens:
        return 0.0
    return len(left_tokens & right_tokens) / min(len(left_tokens), len(right_tokens))


def _similarity_ratio(left: str, right: str) -> float:
    left_norm = _normalize_text(left)
    right_norm = _normalize_text(right)
    if not left_norm or not right_norm:
        return 0.0
    return SequenceMatcher(None, left_norm, right_norm).ratio()


def _is_meaningful_ocr_text(text: str) -> bool:
    normalized = _normalize_text(text)
    token_count = len(_tokenize(text))
    return len(normalized) >= 6 and token_count >= 1


def _extract_question_image_names(question_html: str, question_num: str) -> list[str]:
    prefix = f"{question_num}-img-"
    return [name for name in _IMG_SRC_PATTERN.findall(question_html) if name.startswith(prefix)]


def _extract_existing_solution_indexes(solution_html: str, question_num: str) -> list[int]:
    indexes: list[int] = []
    prefix = f"{question_num}-sol-img-"
    for name in _IMG_SRC_PATTERN.findall(solution_html):
        if not name.startswith(prefix):
            continue
        try:
            indexes.append(int(Path(name).stem.split("-")[-1]))
        except ValueError:
            continue
    return indexes


def _extract_choice_texts(question_html: str) -> dict[str, str]:
    choices: dict[str, str] = {}
    for letter, fragment in _CHOICE_PATTERN.findall(question_html):
        choices[letter.upper()] = _strip_tags(fragment)
    return choices


def _extract_prompt_text(question_html: str) -> str:
    fragments = re.findall(r"<p>(.*?)</p>", question_html, flags=re.IGNORECASE | re.DOTALL)
    prompt_parts: list[str] = []
    for fragment in fragments:
        if "<img" in fragment.lower():
            continue
        if re.search(r"[A-E]\)\s*.*<br>", fragment, re.IGNORECASE | re.DOTALL):
            break
        text = _strip_tags(fragment)
        if text:
            prompt_parts.append(text)
    return "\n".join(prompt_parts)


def _line_with_choice_marker(text: str, letter: str) -> str:
    for raw_line in (text or "").splitlines():
        if re.match(rf"\s*{re.escape(letter)}[\)\.\:-]\s*", raw_line, re.IGNORECASE):
            return raw_line.strip()
    return ""


def _score_image_text(
    *,
    ocr_text: str,
    correct_letter: str,
    correct_choice_text: str,
    prompt_text: str,
) -> ImageDecision:
    excerpt = _WHITESPACE_PATTERN.sub(" ", (ocr_text or "").strip())[:240]
    if not _is_meaningful_ocr_text(ocr_text):
        return ImageDecision(
            destination="question",
            score=0,
            stem_score=0,
            rule_hits=["no_meaningful_text"],
            ocr_excerpt=excerpt,
        )

    raw_text = ocr_text or ""
    raw_lower = raw_text.lower()
    normalized = _normalize_text(raw_text)
    prompt_norm = _normalize_text(prompt_text)
    correct_choice_norm = _normalize_text(correct_choice_text)
    tokens = _tokenize(raw_text)
    word_count = len(tokens)
    numeric_token_count = sum(any(ch.isdigit() for ch in token) for token in tokens)
    numeric_ratio = numeric_token_count / word_count if word_count else 0.0

    answer_score = 0
    stem_score = 0
    rule_hits: list[str] = []

    for pattern in _ANSWER_CUE_PATTERNS:
        if pattern.search(raw_text):
            answer_score += 4
            rule_hits.append(f"answer_cue:{pattern.pattern}")
            break

    if re.search(
        rf"\b(?:option|choice|answer|correct)\s*[:=-]?\s*{re.escape(correct_letter.lower())}\b",
        raw_lower,
    ) or re.search(
        rf"\b{re.escape(correct_letter.lower())}\s*(?:is|=|:|-)?\s*(?:correct|answer)\b",
        raw_lower,
    ):
        answer_score += 3
        rule_hits.append("correct_letter_cue")

    if correct_choice_norm:
        if correct_choice_norm in normalized:
            answer_score += 4
            rule_hits.append("exact_correct_choice_match")
        else:
            similarity = _similarity_ratio(raw_text, correct_choice_text)
            overlap = _token_overlap_ratio(raw_text, correct_choice_text)
            if similarity >= 0.72 or overlap >= 0.75:
                answer_score += 3
                rule_hits.append("strong_correct_choice_match")

    option_markers = len(_OPTION_MARKER_PATTERN.findall(raw_text))
    correct_line = _line_with_choice_marker(raw_text, correct_letter)
    if option_markers >= 3 and correct_line:
        answer_score += 3
        rule_hits.append("multiple_option_lines_with_correct")
    elif option_markers >= 3:
        answer_score += 1
        rule_hits.append("multiple_option_lines")

    if word_count >= 18 and any(hint in normalized for hint in _EXPLANATION_HINTS):
        answer_score += 2
        rule_hits.append("explanation_style_prose")

    overlap = _token_overlap_ratio(raw_text, prompt_text)
    similarity = _similarity_ratio(raw_text, prompt_text)
    if overlap >= 0.45 or similarity >= 0.55:
        stem_score += 3
        rule_hits.append("prompt_overlap")

    if word_count <= 12 and numeric_ratio >= 0.2 and answer_score == 0:
        stem_score += 2
        rule_hits.append("short_structured_text")

    if word_count <= 18 and answer_score == 0 and option_markers == 0 and prompt_norm:
        stem_score += 1
        rule_hits.append("brief_exhibit_text")

    if answer_score >= 4 and answer_score >= stem_score:
        destination = "solution"
    elif stem_score >= 3 and answer_score == 0:
        destination = "question"
    elif answer_score == 0 and stem_score >= 2 and word_count <= 18:
        destination = "question"
    else:
        destination = "solution"
        if "ambiguous_text_bias_to_solution" not in rule_hits:
            rule_hits.append("ambiguous_text_bias_to_solution")

    return ImageDecision(
        destination=destination,
        score=answer_score,
        stem_score=stem_score,
        rule_hits=rule_hits,
        ocr_excerpt=excerpt,
    )


def _default_ocr_text(image_path: Path) -> str:
    try:
        import pytesseract
        from PIL import Image, ImageOps
    except ImportError as exc:  # pragma: no cover - environment dependent
        raise RuntimeError(
            "Local OCR requires pytesseract and Pillow. Install them before running repair."
        ) from exc

    try:
        image = Image.open(image_path)
    except Exception as exc:  # pragma: no cover - filesystem/image dependent
        raise RuntimeError(f"Unable to open image for OCR: {image_path}") from exc

    grayscale = ImageOps.grayscale(image)
    autocontrast = ImageOps.autocontrast(grayscale)
    return pytesseract.image_to_string(autocontrast)


def _remove_question_images(question_html: str, image_names: list[str]) -> str:
    updated = question_html
    for image_name in image_names:
        block_pattern = re.compile(
            rf'\s*<p>\s*<img\b[^>]*src="\./{re.escape(image_name)}"[^>]*>\s*</p>',
            re.IGNORECASE,
        )
        updated = block_pattern.sub("", updated)
    return updated


def _insert_solution_images(solution_html: str, image_names: list[str]) -> str:
    if not image_names:
        return solution_html
    snippet = "\n" + "\n".join(f'<p><img src="./{name}"></p>' for name in image_names) + "\n"
    anchor = "<p><strong>Why other answers are incorrect:</strong></p>"
    if anchor in solution_html:
        return solution_html.replace(anchor, snippet + anchor, 1)
    return solution_html.replace("</body>", snippet + "</body>", 1)


def repair_quail_qbank_images(
    source_dir: str | Path,
    output_dir: str | Path | None = None,
    *,
    dry_run: bool = False,
    logger: Callable[[str], None] | None = None,
    ocr_text_fn: Callable[[Path], str] | None = None,
) -> QuailRepairSummary:
    """Copy and repair a flat Quail export using local OCR heuristics."""
    logger_fn = logger or _default_logger
    source_path = Path(source_dir).resolve()
    if not source_path.exists() or not source_path.is_dir():
        raise FileNotFoundError(f"Quail source directory not found: {source_path}")

    target_path = Path(output_dir).resolve() if output_dir else default_repair_output_dir(source_path)
    if source_path == target_path:
        raise ValueError("Repair output directory must differ from the source directory.")

    choices_path = source_path / "choices.json"
    if not choices_path.exists():
        raise FileNotFoundError(f"choices.json not found in {source_path}")

    try:
        choices_data = json.loads(choices_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON in {choices_path}") from exc

    if not isinstance(choices_data, dict):
        raise ValueError("choices.json must contain a JSON object keyed by question number.")

    summary = QuailRepairSummary(
        source_dir=source_path,
        output_dir=target_path,
        dry_run=dry_run,
    )

    if dry_run:
        logger_fn(f"Dry-run: would copy {source_path} -> {target_path}")
        working_path = source_path
    else:
        if target_path.exists():
            raise FileExistsError(f"Repair output directory already exists: {target_path}")
        target_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(source_path, target_path)
        logger_fn(f"Copied source qbank to {target_path}")
        working_path = target_path

    ocr_reader = ocr_text_fn or _default_ocr_text

    for question_num in sorted(choices_data.keys()):
        summary.questions_scanned += 1
        metadata = choices_data.get(question_num, {})
        if not isinstance(metadata, dict):
            logger_fn(f"Skipping malformed choice entry for {question_num}")
            continue

        question_html_path = working_path / f"{question_num}-q.html"
        solution_html_path = working_path / f"{question_num}-s.html"
        if not question_html_path.exists() or not solution_html_path.exists():
            logger_fn(f"Skipping {question_num}: missing question or solution HTML.")
            continue

        question_html = question_html_path.read_text(encoding="utf-8")
        solution_html = solution_html_path.read_text(encoding="utf-8")
        question_images = _extract_question_image_names(question_html, question_num)
        if not question_images:
            continue

        correct_letter = str(metadata.get("correct", "")).strip().upper()
        choice_texts = _extract_choice_texts(question_html)
        correct_choice_text = choice_texts.get(correct_letter, "")
        prompt_text = _extract_prompt_text(question_html)
        moved_pairs: list[tuple[str, str]] = []
        next_solution_index = max(_extract_existing_solution_indexes(solution_html, question_num), default=0) + 1

        for image_name in question_images:
            image_path = working_path / image_name
            if not image_path.exists():
                logger_fn(f"Question {question_num}: image missing, leaving in place: {image_name}")
                continue

            summary.images_scanned += 1
            ocr_text = ocr_reader(image_path)
            decision = _score_image_text(
                ocr_text=ocr_text,
                correct_letter=correct_letter,
                correct_choice_text=correct_choice_text,
                prompt_text=prompt_text,
            )

            audit_entry = {
                "question_number": question_num,
                "original_image": image_name,
                "final_destination": decision.destination,
                "score": decision.score,
                "stem_score": decision.stem_score,
                "rule_hits": decision.rule_hits,
                "ocr_excerpt": decision.ocr_excerpt,
            }

            if decision.destination == "solution":
                new_name = f"{question_num}-sol-img-{next_solution_index}{image_path.suffix.lower() or '.png'}"
                next_solution_index += 1
                audit_entry["renamed_image"] = new_name
                moved_pairs.append((image_name, new_name))
                summary.images_moved += 1
            else:
                summary.images_kept += 1

            summary.audit_entries.append(audit_entry)

        if not moved_pairs:
            continue

        moved_old_names = [old_name for old_name, _new_name in moved_pairs]
        moved_new_names = [new_name for _old_name, new_name in moved_pairs]

        if dry_run:
            logger_fn(
                f"Question {question_num}: would move {len(moved_pairs)} image(s) to solution HTML."
            )
            continue

        for old_name, new_name in moved_pairs:
            (working_path / old_name).rename(working_path / new_name)

        updated_question_html = _remove_question_images(question_html, moved_old_names)
        updated_solution_html = _insert_solution_images(solution_html, moved_new_names)
        question_html_path.write_text(updated_question_html, encoding="utf-8")
        solution_html_path.write_text(updated_solution_html, encoding="utf-8")
        logger_fn(f"Question {question_num}: moved {len(moved_pairs)} image(s) to solution HTML.")

    if not dry_run:
        report_path = target_path / "repair_report.json"
        report_path.write_text(json.dumps(summary.to_dict(), indent=2), encoding="utf-8")
        logger_fn(f"Wrote repair report: {report_path}")

    return summary


__all__ = [
    "ImageDecision",
    "QuailRepairSummary",
    "default_repair_output_dir",
    "repair_quail_qbank_images",
]
