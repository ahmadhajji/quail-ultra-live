"""Export existing native-pack questions matched from selected PPTX slides.

This utility is intentionally offline: it reads an existing Quail Ultra native
pack and a selected-slides PPTX, matches slides by deterministic text/image
signals, then writes a review PDF plus JSON/CSV match reports. It does not call
OpenAI or rerun extraction/formatting.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import html
import json
import re
import shutil
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any

from PIL import Image as PILImage
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    Image,
    ListFlowable,
    ListItem,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from export.native_contract import NATIVE_QBANK_MANIFEST
from parsers.pptx_parser import parse_pptx
from utils.image_renderer import pptx_to_images


STOPWORDS = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "by",
    "for",
    "from",
    "has",
    "have",
    "in",
    "is",
    "it",
    "of",
    "on",
    "or",
    "that",
    "the",
    "this",
    "to",
    "with",
}

RASTER_EXTENSIONS = {".bmp", ".gif", ".jpeg", ".jpg", ".png", ".tif", ".tiff", ".webp"}


@dataclass
class NativeQuestionEntry:
    qid: str
    path: Path
    question: dict[str, Any]
    source_key: str
    source_slide_path: Path | None
    searchable_text: str


@dataclass
class SourceSlideGroup:
    source_key: str
    document_id: str
    document_title: str
    slide_number: int
    source_slide_path: Path | None = None
    questions: list[NativeQuestionEntry] = field(default_factory=list)
    searchable_text: str = ""


@dataclass
class SelectedSlide:
    slide_number: int
    text: str
    image_paths: list[Path]


@dataclass
class CandidateScore:
    source_key: str
    text_score: float
    image_score: float
    score: float
    question_ids: list[str]


@dataclass
class SlideMatch:
    selected_slide_number: int
    selected_text_preview: str
    matched_source_key: str
    matched_document_id: str
    matched_slide_number: int
    score: float
    text_score: float
    image_score: float
    confidence: str
    question_ids: list[str]
    alternatives: list[CandidateScore]


def normalize_text(value: str) -> str:
    cleaned = re.sub(r"[^a-z0-9]+", " ", str(value or "").lower())
    return re.sub(r"\s+", " ", cleaned).strip()


def text_tokens(value: str) -> set[str]:
    return {token for token in normalize_text(value).split() if token and token not in STOPWORDS}


def text_similarity(left: str, right: str) -> float:
    left_norm = normalize_text(left)
    right_norm = normalize_text(right)
    if not left_norm or not right_norm:
        return 0.0
    left_tokens = text_tokens(left_norm)
    right_tokens = text_tokens(right_norm)
    jaccard = len(left_tokens & right_tokens) / max(len(left_tokens | right_tokens), 1)
    sequence = SequenceMatcher(None, left_norm, right_norm).ratio()
    containment = len(left_tokens & right_tokens) / max(min(len(left_tokens), len(right_tokens)), 1)
    return round((jaccard * 0.55) + (sequence * 0.25) + (containment * 0.20), 4)


def blocks_to_text(blocks: Any) -> str:
    parts: list[str] = []
    if not isinstance(blocks, list):
        return ""
    for block in blocks:
        if not isinstance(block, dict):
            continue
        block_type = block.get("type")
        if block_type == "paragraph":
            parts.append(str(block.get("text", "")))
        elif block_type == "list":
            parts.extend(str(item) for item in block.get("items", []) if str(item).strip())
        elif block_type == "table":
            for row in block.get("rows", []):
                if isinstance(row, list):
                    parts.append(" ".join(str(cell) for cell in row))
    return "\n".join(part for part in parts if part.strip())


def question_to_searchable_text(question: dict[str, Any]) -> str:
    parts: list[str] = []
    source = question.get("source", {}) if isinstance(question.get("source"), dict) else {}
    tags = question.get("tags", {}) if isinstance(question.get("tags"), dict) else {}
    parts.extend(str(source.get(key, "")) for key in ("documentId", "documentTitle", "sourceGroupId"))
    parts.extend(str(tags.get(key, "")) for key in ("rotation", "subject", "system", "topic", "subtopic", "source_material"))
    stem = question.get("stem", {}) if isinstance(question.get("stem"), dict) else {}
    parts.append(blocks_to_text(stem.get("blocks", [])))
    for choice in question.get("choices", []) if isinstance(question.get("choices"), list) else []:
        if isinstance(choice, dict):
            parts.append(blocks_to_text(choice.get("text", [])))
    explanation = question.get("explanation", {}) if isinstance(question.get("explanation"), dict) else {}
    parts.append(blocks_to_text(explanation.get("correct", [])))
    parts.append(blocks_to_text(explanation.get("educationalObjective", [])))
    incorrect = explanation.get("incorrect", {})
    if isinstance(incorrect, dict):
        parts.extend(blocks_to_text(value) for value in incorrect.values())
    return "\n".join(part for part in parts if part.strip())


def safe_pack_path(pack_dir: Path, relative_path: str) -> Path | None:
    if not relative_path:
        return None
    candidate = (pack_dir / relative_path).resolve()
    try:
        candidate.relative_to(pack_dir.resolve())
    except ValueError:
        return None
    return candidate if candidate.exists() else None


def load_native_slide_groups(pack_dir: str | Path) -> dict[str, SourceSlideGroup]:
    root = Path(pack_dir).resolve()
    manifest_path = root / NATIVE_QBANK_MANIFEST
    if not manifest_path.exists():
        raise FileNotFoundError(f"Native pack manifest not found: {manifest_path}")

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    media_by_id = {
        str(media.get("id", "")): media
        for media in manifest.get("mediaIndex", [])
        if isinstance(media, dict)
    }
    groups: dict[str, SourceSlideGroup] = {}

    for entry in manifest.get("questionIndex", []):
        if not isinstance(entry, dict):
            continue
        question_path = safe_pack_path(root, str(entry.get("path", "")))
        if question_path is None:
            continue
        question = json.loads(question_path.read_text(encoding="utf-8"))
        source = question.get("source", {}) if isinstance(question.get("source"), dict) else {}
        document_id = str(source.get("documentId", "") or "")
        slide_number = int(source.get("slideNumber", 0) or 0)
        if not document_id or slide_number <= 0:
            continue
        source_key = f"{document_id}:{slide_number}"
        source_slide_media_id = str(source.get("sourceSlideMediaId", "") or "")
        source_slide_path = None
        if source_slide_media_id and source_slide_media_id in media_by_id:
            source_slide_path = safe_pack_path(root, str(media_by_id[source_slide_media_id].get("path", "")))
        if source_slide_path is None:
            for media in question.get("media", []) if isinstance(question.get("media"), list) else []:
                if isinstance(media, dict) and media.get("role") == "source_slide":
                    source_slide_path = safe_pack_path(root, str(media.get("path", "")))
                    break

        searchable_text = question_to_searchable_text(question)
        native_entry = NativeQuestionEntry(
            qid=str(question.get("id", entry.get("id", ""))),
            path=question_path,
            question=question,
            source_key=source_key,
            source_slide_path=source_slide_path,
            searchable_text=searchable_text,
        )
        group = groups.setdefault(
            source_key,
            SourceSlideGroup(
                source_key=source_key,
                document_id=document_id,
                document_title=str(source.get("documentTitle", "") or ""),
                slide_number=slide_number,
                source_slide_path=source_slide_path,
            ),
        )
        if group.source_slide_path is None and source_slide_path is not None:
            group.source_slide_path = source_slide_path
        group.questions.append(native_entry)

    for group in groups.values():
        group.questions.sort(key=lambda item: int(item.question.get("source", {}).get("questionIndex", 1) or 1))
        group.searchable_text = "\n".join(question.searchable_text for question in group.questions)
    return groups


def image_sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def average_hash(path: Path, hash_size: int = 8) -> int | None:
    try:
        with PILImage.open(path) as image:
            gray = image.convert("L").resize((hash_size, hash_size), PILImage.Resampling.LANCZOS)
            pixels = list(gray.getdata())
    except Exception:
        return None
    average = sum(pixels) / len(pixels)
    bits = 0
    for pixel in pixels:
        bits = (bits << 1) | int(pixel >= average)
    return bits


def hamming_distance(left: int, right: int) -> int:
    return int((left ^ right).bit_count())


def image_similarity(left: Path | None, right_paths: list[Path]) -> float:
    if left is None or not left.exists() or not right_paths:
        return 0.0
    left_hash = ""
    try:
        left_hash = image_sha256(left)
    except Exception:
        left_hash = ""
    left_average_hash = average_hash(left)
    best = 0.0
    for right in right_paths:
        if not right.exists():
            continue
        try:
            if left_hash and image_sha256(right) == left_hash:
                return 1.0
        except Exception:
            pass
        if left_average_hash is None:
            continue
        right_average_hash = average_hash(right)
        if right_average_hash is None:
            continue
        distance = hamming_distance(left_average_hash, right_average_hash)
        score = max(0.0, 1.0 - (distance / 32.0))
        best = max(best, score)
    return round(best, 4)


def parse_selected_slides(pptx_path: str | Path, work_dir: str | Path) -> list[SelectedSlide]:
    work_root = Path(work_dir)
    extracted_dir = work_root / "selected-extracted-images"
    rendered_dir = work_root / "selected-rendered-slides"
    slides = parse_pptx(pptx_path, extracted_dir)

    rendered_by_slide: dict[int, Path] = {}
    try:
        rendered = pptx_to_images(pptx_path, rendered_dir)
        rendered_by_slide = {index + 1: Path(path) for index, path in enumerate(rendered)}
    except Exception:
        rendered_by_slide = {}

    selected: list[SelectedSlide] = []
    for slide in slides:
        text = "\n".join(
            part
            for part in [
                "\n".join(slide.texts),
                slide.speaker_notes,
                "\n".join(slide.highlighted_texts),
            ]
            if part
        )
        image_paths = [Path(path) for path in slide.images if Path(path).exists()]
        if slide.slide_number in rendered_by_slide:
            image_paths.insert(0, rendered_by_slide[slide.slide_number])
        selected.append(SelectedSlide(slide_number=slide.slide_number, text=text, image_paths=image_paths))
    return selected


def score_candidates(selected: SelectedSlide, groups: dict[str, SourceSlideGroup]) -> list[CandidateScore]:
    candidates: list[CandidateScore] = []
    for group in groups.values():
        text_score = text_similarity(selected.text, group.searchable_text)
        image_score = image_similarity(group.source_slide_path, selected.image_paths)
        if image_score >= 0.98:
            score = 0.95 + (text_score * 0.05)
        elif image_score >= 0.65:
            score = (image_score * 0.70) + (text_score * 0.30)
        elif not selected.image_paths or group.source_slide_path is None:
            score = text_score
        else:
            score = (image_score * 0.35) + (text_score * 0.65)
        candidates.append(
            CandidateScore(
                source_key=group.source_key,
                text_score=round(text_score, 4),
                image_score=round(image_score, 4),
                score=round(score, 4),
                question_ids=[entry.qid for entry in group.questions],
            )
        )
    return sorted(candidates, key=lambda item: item.score, reverse=True)


def match_selected_slides(
    selected_slides: list[SelectedSlide],
    groups: dict[str, SourceSlideGroup],
    *,
    min_score: float = 0.20,
    ambiguous_margin: float = 0.05,
) -> list[SlideMatch]:
    matches: list[SlideMatch] = []
    for selected in selected_slides:
        candidates = score_candidates(selected, groups)
        best = candidates[0] if candidates else None
        alternatives = candidates[1:4] if candidates else []
        if best is None or best.score < min_score:
            confidence = "unmatched"
            matched_group = None
        else:
            second_score = alternatives[0].score if alternatives else 0.0
            confidence = "ambiguous" if second_score and (best.score - second_score) <= ambiguous_margin else "matched"
            matched_group = groups[best.source_key]
        matches.append(
            SlideMatch(
                selected_slide_number=selected.slide_number,
                selected_text_preview=normalize_text(selected.text)[:160],
                matched_source_key=matched_group.source_key if matched_group else "",
                matched_document_id=matched_group.document_id if matched_group else "",
                matched_slide_number=matched_group.slide_number if matched_group else 0,
                score=best.score if best else 0.0,
                text_score=best.text_score if best else 0.0,
                image_score=best.image_score if best else 0.0,
                confidence=confidence,
                question_ids=best.question_ids if matched_group and best else [],
                alternatives=alternatives,
            )
        )
    return matches


def match_to_dict(match: SlideMatch) -> dict[str, Any]:
    return {
        "selectedSlideNumber": match.selected_slide_number,
        "selectedTextPreview": match.selected_text_preview,
        "matchedSourceKey": match.matched_source_key,
        "matchedDocumentId": match.matched_document_id,
        "matchedSlideNumber": match.matched_slide_number,
        "score": match.score,
        "textScore": match.text_score,
        "imageScore": match.image_score,
        "confidence": match.confidence,
        "questionIds": match.question_ids,
        "alternatives": [
            {
                "sourceKey": alternative.source_key,
                "score": alternative.score,
                "textScore": alternative.text_score,
                "imageScore": alternative.image_score,
                "questionIds": alternative.question_ids,
            }
            for alternative in match.alternatives
        ],
    }


def write_match_reports(matches: list[SlideMatch], output_dir: Path) -> tuple[Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    json_path = output_dir / "native_pack_pdf_matches.json"
    csv_path = output_dir / "native_pack_pdf_matches.csv"
    json_path.write_text(json.dumps([match_to_dict(match) for match in matches], indent=2), encoding="utf-8")
    with csv_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "selected_slide_number",
                "matched_source_key",
                "matched_document_id",
                "matched_slide_number",
                "confidence",
                "score",
                "text_score",
                "image_score",
                "question_ids",
            ],
        )
        writer.writeheader()
        for match in matches:
            writer.writerow(
                {
                    "selected_slide_number": match.selected_slide_number,
                    "matched_source_key": match.matched_source_key,
                    "matched_document_id": match.matched_document_id,
                    "matched_slide_number": match.matched_slide_number or "",
                    "confidence": match.confidence,
                    "score": f"{match.score:.4f}",
                    "text_score": f"{match.text_score:.4f}",
                    "image_score": f"{match.image_score:.4f}",
                    "question_ids": ";".join(match.question_ids),
                }
            )
    return json_path, csv_path


def html_escape(value: Any) -> str:
    return html.escape(str(value or "")).replace("\n", "<br/>")


def media_path_for_id(question: dict[str, Any], media_id: str, pack_dir: Path) -> Path | None:
    for media in question.get("media", []) if isinstance(question.get("media"), list) else []:
        if isinstance(media, dict) and str(media.get("id", "")) == media_id:
            return safe_pack_path(pack_dir, str(media.get("path", "")))
    return None


def image_flowable(path: Path, max_width: float, max_height: float) -> Image | Paragraph:
    if path.suffix.lower() not in RASTER_EXTENSIONS:
        return Paragraph(f"Image omitted from PDF preview: {html_escape(path.name)}", get_pdf_styles()["Small"])
    try:
        with PILImage.open(path) as image:
            width_px, height_px = image.size
    except Exception:
        return Paragraph(f"Image could not be opened: {html_escape(path.name)}", get_pdf_styles()["Small"])
    if width_px <= 0 or height_px <= 0:
        return Paragraph(f"Image has invalid dimensions: {html_escape(path.name)}", get_pdf_styles()["Small"])
    ratio = min(max_width / width_px, max_height / height_px, 1.0)
    return Image(str(path), width=width_px * ratio, height=height_px * ratio)


def get_pdf_styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    return {
        "Title": ParagraphStyle("Title", parent=base["Title"], fontSize=20, leading=24, spaceAfter=14),
        "H1": ParagraphStyle("H1", parent=base["Heading1"], fontSize=15, leading=18, spaceBefore=12, spaceAfter=8),
        "H2": ParagraphStyle("H2", parent=base["Heading2"], fontSize=12, leading=15, spaceBefore=8, spaceAfter=6),
        "Body": ParagraphStyle("Body", parent=base["BodyText"], fontSize=9.5, leading=12.5, spaceAfter=5),
        "Small": ParagraphStyle("Small", parent=base["BodyText"], fontSize=8, leading=10, textColor=colors.HexColor("#555555")),
        "CenterSmall": ParagraphStyle("CenterSmall", parent=base["BodyText"], fontSize=8, leading=10, alignment=TA_CENTER),
        "Choice": ParagraphStyle("Choice", parent=base["BodyText"], fontSize=9.5, leading=12.5, leftIndent=10, spaceAfter=4),
    }


def blocks_to_flowables(blocks: Any, question: dict[str, Any], pack_dir: Path, styles: dict[str, ParagraphStyle]) -> list[Any]:
    flowables: list[Any] = []
    if not isinstance(blocks, list):
        return flowables
    for block in blocks:
        if not isinstance(block, dict):
            continue
        block_type = block.get("type")
        if block_type == "paragraph":
            flowables.append(Paragraph(html_escape(block.get("text", "")), styles["Body"]))
        elif block_type == "list":
            items = [
                ListItem(Paragraph(html_escape(item), styles["Body"]))
                for item in block.get("items", [])
                if str(item).strip()
            ]
            if items:
                flowables.append(ListFlowable(items, bulletType="bullet", leftIndent=18))
        elif block_type == "table":
            rows = [
                [Paragraph(html_escape(cell), styles["Body"]) for cell in row]
                for row in block.get("rows", [])
                if isinstance(row, list)
            ]
            if rows:
                table = Table(rows, hAlign="LEFT")
                table.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.25, colors.lightgrey), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
                flowables.append(table)
        elif block_type == "media":
            media_id = str(block.get("mediaId", "") or "")
            media_path = media_path_for_id(question, media_id, pack_dir)
            if media_path:
                flowables.append(image_flowable(media_path, 6.4 * inch, 3.4 * inch))
                caption = str(block.get("caption", "") or media_id)
                if caption:
                    flowables.append(Paragraph(html_escape(caption), styles["CenterSmall"]))
    return flowables


def render_question_flowables(question: dict[str, Any], pack_dir: Path, styles: dict[str, ParagraphStyle]) -> list[Any]:
    flowables: list[Any] = []
    qid = str(question.get("id", "") or "")
    source = question.get("source", {}) if isinstance(question.get("source"), dict) else {}
    tags = question.get("tags", {}) if isinstance(question.get("tags"), dict) else {}
    correct_id = str(question.get("answerKey", {}).get("correctChoiceId", "") or "")

    meta = (
        f"Question {qid} | Source {source.get('documentId', '')}:{source.get('slideNumber', '')} "
        f"| Question index {source.get('questionIndex', '')}"
    )
    flowables.append(Paragraph(html_escape(meta), styles["Small"]))
    topic = " / ".join(str(tags.get(key, "")) for key in ("rotation", "system", "topic") if str(tags.get(key, "")).strip())
    if topic:
        flowables.append(Paragraph(html_escape(topic), styles["Small"]))

    stem = question.get("stem", {}) if isinstance(question.get("stem"), dict) else {}
    flowables.append(Paragraph("Question", styles["H2"]))
    flowables.extend(blocks_to_flowables(stem.get("blocks", []), question, pack_dir, styles))

    choices = sorted(
        [choice for choice in question.get("choices", []) if isinstance(choice, dict)],
        key=lambda choice: int(choice.get("displayOrder", 0) or 0),
    )
    choice_rows = []
    for choice in choices:
        choice_id = str(choice.get("id", "") or "")
        choice_text = blocks_to_text(choice.get("text", []))
        marker = " (correct)" if choice_id == correct_id else ""
        choice_rows.append([Paragraph(f"<b>{html_escape(choice_id)}.</b>{html_escape(marker)}", styles["Choice"]), Paragraph(html_escape(choice_text), styles["Choice"])])
    if choice_rows:
        table = Table(choice_rows, colWidths=[0.9 * inch, 5.7 * inch], hAlign="LEFT")
        table.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("ROWBACKGROUNDS", (0, 0), (-1, -1), [colors.white, colors.HexColor("#f7f7f7")])]))
        flowables.append(table)

    explanation = question.get("explanation", {}) if isinstance(question.get("explanation"), dict) else {}
    flowables.append(Paragraph(f"Correct Answer: {html_escape(correct_id)}", styles["H2"]))
    flowables.extend(blocks_to_flowables(explanation.get("correct", []), question, pack_dir, styles))

    incorrect = explanation.get("incorrect", {})
    if isinstance(incorrect, dict) and incorrect:
        flowables.append(Paragraph("Incorrect Answer Explanations", styles["H2"]))
        for letter in sorted(incorrect):
            flowables.append(Paragraph(f"<b>{html_escape(letter)}</b>", styles["Small"]))
            flowables.extend(blocks_to_flowables(incorrect[letter], question, pack_dir, styles))

    objective = explanation.get("educationalObjective", [])
    if objective:
        flowables.append(Paragraph("Educational Objective", styles["H2"]))
        flowables.extend(blocks_to_flowables(objective, question, pack_dir, styles))
    return flowables


def build_pdf(matches: list[SlideMatch], groups: dict[str, SourceSlideGroup], pack_dir: Path, output_pdf: Path, *, include_source_slide: bool = True) -> None:
    output_pdf.parent.mkdir(parents=True, exist_ok=True)
    doc = SimpleDocTemplate(
        str(output_pdf),
        pagesize=letter,
        rightMargin=0.55 * inch,
        leftMargin=0.55 * inch,
        topMargin=0.55 * inch,
        bottomMargin=0.55 * inch,
        title="Matched Native Pack Questions",
    )
    styles = get_pdf_styles()
    story: list[Any] = [
        Paragraph("Matched Native Pack Questions", styles["Title"]),
        Paragraph("Generated from existing native qbank JSON. No extraction, formatting, or LLM inference was run.", styles["Small"]),
        Spacer(1, 0.15 * inch),
    ]

    matched_count = 0
    for match in matches:
        if match.confidence == "unmatched" or not match.matched_source_key:
            continue
        group = groups[match.matched_source_key]
        matched_count += len(group.questions)
        story.append(PageBreak())
        story.append(
            Paragraph(
                f"Selected slide {match.selected_slide_number} -> {html_escape(group.document_id)}:{group.slide_number}",
                styles["H1"],
            )
        )
        story.append(Paragraph(f"Match score {match.score:.2f} ({match.confidence}); questions: {', '.join(match.question_ids)}", styles["Small"]))
        if include_source_slide and group.source_slide_path:
            story.append(image_flowable(group.source_slide_path, 6.4 * inch, 3.4 * inch))
            story.append(Paragraph("Stored source slide", styles["CenterSmall"]))
        for index, entry in enumerate(group.questions, start=1):
            if index > 1:
                story.append(Spacer(1, 0.18 * inch))
            story.extend(render_question_flowables(entry.question, pack_dir, styles))

    unresolved = [match for match in matches if match.confidence in {"unmatched", "ambiguous"}]
    if unresolved:
        story.append(PageBreak())
        story.append(Paragraph("Unmatched Or Ambiguous Slides", styles["H1"]))
        for match in unresolved:
            story.append(
                Paragraph(
                    f"Selected slide {match.selected_slide_number}: {match.confidence}, best score {match.score:.2f}, best source {html_escape(match.matched_source_key or 'none')}",
                    styles["Body"],
                )
            )
            if match.alternatives:
                story.append(Paragraph("Alternatives: " + ", ".join(f"{item.source_key} ({item.score:.2f})" for item in match.alternatives), styles["Small"]))

    if matched_count == 0:
        story.append(Paragraph("No matched questions met the configured threshold.", styles["Body"]))
    doc.build(story)


def export_selected_pack_questions_to_pdf(
    *,
    pack_dir: str | Path,
    pptx_path: str | Path,
    output_pdf: str | Path,
    output_dir: str | Path | None = None,
    min_score: float = 0.20,
    ambiguous_margin: float = 0.05,
    include_source_slide: bool = True,
    fail_on_ambiguous: bool = False,
) -> tuple[list[SlideMatch], Path, Path]:
    pack_root = Path(pack_dir).resolve()
    pdf_path = Path(output_pdf).resolve()
    report_dir = Path(output_dir).resolve() if output_dir else pdf_path.parent
    work_dir = report_dir / "native_pack_pdf_work"
    if work_dir.exists():
        shutil.rmtree(work_dir)
    work_dir.mkdir(parents=True, exist_ok=True)

    groups = load_native_slide_groups(pack_root)
    selected = parse_selected_slides(pptx_path, work_dir)
    matches = match_selected_slides(selected, groups, min_score=min_score, ambiguous_margin=ambiguous_margin)
    json_report, csv_report = write_match_reports(matches, report_dir)

    if fail_on_ambiguous and any(match.confidence in {"ambiguous", "unmatched"} for match in matches):
        return matches, json_report, csv_report

    build_pdf(matches, groups, pack_root, pdf_path, include_source_slide=include_source_slide)
    return matches, json_report, csv_report


def main() -> None:
    parser = argparse.ArgumentParser(description="Export existing native-pack questions matched from selected PPTX slides to PDF.")
    parser.add_argument("--pack-dir", required=True, help="Path to native Quail Ultra pack directory.")
    parser.add_argument("--pptx", required=True, help="Path to selected-slides PPTX.")
    parser.add_argument("--output-pdf", required=True, help="Path for the generated PDF.")
    parser.add_argument("--output-dir", default=None, help="Directory for JSON/CSV match reports. Defaults to PDF parent.")
    parser.add_argument("--min-score", type=float, default=0.20, help="Minimum match score required to include a slide.")
    parser.add_argument("--ambiguous-margin", type=float, default=0.05, help="Mark as ambiguous when top candidates are within this score margin.")
    parser.add_argument("--no-source-slide-thumbnails", action="store_true", help="Do not include stored source-slide thumbnails in the PDF.")
    parser.add_argument("--fail-on-ambiguous", action="store_true", help="Write reports but skip PDF generation if any slide is ambiguous or unmatched.")
    args = parser.parse_args()

    matches, json_report, csv_report = export_selected_pack_questions_to_pdf(
        pack_dir=args.pack_dir,
        pptx_path=args.pptx,
        output_pdf=args.output_pdf,
        output_dir=args.output_dir,
        min_score=args.min_score,
        ambiguous_margin=args.ambiguous_margin,
        include_source_slide=not args.no_source_slide_thumbnails,
        fail_on_ambiguous=args.fail_on_ambiguous,
    )
    matched = sum(1 for match in matches if match.confidence != "unmatched")
    ambiguous = sum(1 for match in matches if match.confidence == "ambiguous")
    unmatched = sum(1 for match in matches if match.confidence == "unmatched")
    print(f"Matched {matched}/{len(matches)} selected slides ({ambiguous} ambiguous, {unmatched} unmatched).")
    print(f"JSON report: {json_report}")
    print(f"CSV report: {csv_report}")
    if args.fail_on_ambiguous and (ambiguous or unmatched):
        print("PDF skipped because --fail-on-ambiguous was set.")
    else:
        print(f"PDF: {Path(args.output_pdf).resolve()}")


if __name__ == "__main__":
    main()
