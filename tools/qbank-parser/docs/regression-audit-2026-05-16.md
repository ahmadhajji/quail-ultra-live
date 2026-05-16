# QBank Parser Regression Audit — 2026-05-16

## Scope

Reviewed `tools/qbank-parser` with emphasis on the native qbank output path,
the v2 extraction/detection/rewrite pipeline, and the contracts documented in
`docs/qbank-format.md`.

## Baseline

- `pytest -q`: passed.
- `ruff check .`: passed.
- `ruff format --check .`: failed on three v2 files.
- `mypy main.py app domain storage providers formatting qbank_cli.py`: failed with
  three existing type errors in v2/provider/workflow code.

## Findings Addressed In This Patch

1. V2 safety flags were not wired into the v2 path. `--v2` ignored
   `--slide-range`, `--max-slides`, `--max-questions`, `--reprocess-slide`,
   `--dry-run`, and `--dry-run-cost`, so bounded preview commands could still
   perform full provider work.
2. Legacy and native exporters resolved media paths too broadly. Absolute
   paths and traversal-style relative paths could be read if present on disk,
   which is unsafe for corrupted or untrusted source JSON.
3. Legacy source-slide export used raw `deck_id` in an output filename.
   Traversal characters in the metadata could influence the target path.
4. Stage 2 detection attached slide screenshots and extracted images without
   explicit adjacent labels. That made `stem_image_numbers` and
   `explanation_image_numbers` depend on implicit multimodal ordering.
5. Detection quality signals were too thin. Low confidence, missing stem,
   too-few choices, and missing/mismatched answer keys did not reliably become
   downstream warnings.
6. Three `sys.path.insert` import hacks remained in legacy modules even though
   the parser is packaged with top-level packages.
7. Existing formatting/type failures reduced confidence in regression checks.

## Changes Made

- Added v2 slide/question selection before provider work and v2 dry-run
  behavior that skips detection, rewrite, and export.
- Short-circuited CLI `--v2 --dry-run` / `--v2 --dry-run-cost` before
  downloads, writes, or OpenAI work.
- Constrained exporter media reads to the source JSON directory and explicit
  image directory roots.
- Rejected remote, protocol-relative, traversal, backslash, control-character,
  and outside-root media references.
- Made native export fail hard on unsafe media paths instead of silently
  excluding the question.
- Sanitized/rejected unsafe legacy source-slide `deck_id` filename components.
- Labeled multimodal image payloads as `SLIDE SCREENSHOT` and
  `EXTRACTED IMAGE N`.
- Promoted detection structural risks into `needs_review` warnings.
- Removed lingering import-path hacks and fixed existing mypy issues.

## Remaining Follow-Ups

- Run the documented live v2 validation procedure against a real deck with an
  API key and manually spot-check output quality. The automated suite cannot
  verify clinical quality or live model behavior.
- Decide when to remove the legacy HTML export path listed in
  `docs/v2-migration-kill-list.md`. This patch hardens it because it still
  exists and remains callable.
