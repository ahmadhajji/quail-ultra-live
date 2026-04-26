#!/usr/bin/env python3
"""CLI wrapper for exporting USMLE JSON to Quail format."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from export.native_quail_export import export_native_quail_qbank
from export.quail_export import export_quail_qbank


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Convert USMLE-formatted questions JSON to Quail qbank format."
    )
    parser.add_argument("source_json", help="Path to USMLE questions JSON")
    parser.add_argument(
        "--output",
        "-o",
        default="./output/quail_qbank",
        help="Output directory for Quail qbank (default: ./output/quail_qbank)",
    )
    parser.add_argument(
        "--images",
        "-i",
        default=None,
        help="Directory containing source images (default: auto-detect)",
    )
    parser.add_argument(
        "--append",
        "-a",
        action="store_true",
        help="Append to existing qbank instead of fresh export",
    )
    parser.add_argument(
        "--append-native",
        action="store_true",
        help="Append/update an existing native pack workspace using pack_state.json.",
    )
    parser.add_argument(
        "--native",
        action="store_true",
        help="Export Quail Ultra native structured qbank format instead of legacy Quail HTML.",
    )
    parser.add_argument(
        "--pack-id",
        default="qbank",
        help="Stable pack id for native export (default: qbank)",
    )
    parser.add_argument(
        "--native-pack-dir",
        default=None,
        help="Native pack workspace/output directory. Overrides --output for native export.",
    )
    parser.add_argument(
        "--pack-state",
        default=None,
        help="Path to pack_state.json for native export (default: <native-pack-dir>/pack_state.json).",
    )
    parser.add_argument(
        "--slide-range",
        default=None,
        help="Only export questions from this slide range, e.g. 12-30.",
    )
    parser.add_argument(
        "--max-questions",
        type=int,
        default=None,
        help="Limit the number of source questions included in this native export run.",
    )
    parser.add_argument(
        "--only-new",
        action="store_true",
        help="Native append: export only source questions not yet known in pack_state.json.",
    )
    parser.add_argument(
        "--only-failed",
        action="store_true",
        help="Native append: export only source questions marked failed/blocked in pack_state.json.",
    )
    parser.add_argument(
        "--reprocess-question",
        default=None,
        help="Native append: reprocess only this stable question id.",
    )
    parser.add_argument(
        "--title",
        default=None,
        help="Display title for native export.",
    )

    args = parser.parse_args()

    def parse_slide_range(value: str | None) -> tuple[int, int] | None:
        if not value:
            return None
        if "-" not in value:
            slide = int(value)
            return slide, slide
        start, end = value.split("-", 1)
        return int(start), int(end)

    try:
        if args.native or args.append_native or args.native_pack_dir:
            native_output = Path(args.native_pack_dir) if args.native_pack_dir else Path(args.output)
            summary = export_native_quail_qbank(
                source_json=Path(args.source_json),
                output_dir=native_output,
                images_dir=Path(args.images) if args.images else None,
                append=args.append or args.append_native,
                pack_id=args.pack_id,
                title=args.title,
                pack_state_path=Path(args.pack_state) if args.pack_state else None,
                slide_range=parse_slide_range(args.slide_range),
                max_questions=args.max_questions,
                only_new=args.only_new,
                only_failed=args.only_failed,
                reprocess_question=args.reprocess_question,
            )
        else:
            summary = export_quail_qbank(
                source_json=Path(args.source_json),
                output_dir=Path(args.output),
                images_dir=Path(args.images) if args.images else None,
                append=args.append,
            )
    except Exception as exc:
        print(f"Error: {exc}")
        return 1

    print("\nSummary:")
    questions_added = getattr(summary, "questions_added", getattr(summary, "questions_written", 0))
    print(f"  Questions added: {questions_added}")
    print(f"  Total questions: {summary.total_questions}")
    print(f"  Output: {summary.output_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
