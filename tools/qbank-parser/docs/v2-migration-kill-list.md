# v2 Pipeline Migration — Kill List

This document locks down the deletion plan for the qbank-parser ground-up
simplification (see `/Users/ahmadhajji/.claude/plans/plan-a-review-and-silly-hamming.md`).

The new v2 pipeline ships behind a `--v2` flag (added in PR 2). Once it has
been validated end-to-end on a real Google Slides deck (PR 5), the items
below are deleted in PR 6 and `--v2` is promoted to the default behavior.

Nothing in this list runs in the v2 pipeline. Everything in this list is
either dead, redundant, or contradicts the v2 design philosophy ("the source
is the authority — no fact-check, no web search, no escalation").

## Modules to delete

| Path | Reason |
| --- | --- |
| `qbank_cli.py` | 7-line shim around `main.py`; the v2 entrypoint is `main.py` directly |
| `ai/gemini_processor.py` | Unreachable; `formatter_provider` choices in `main.py` are limited to `["openai"]` |
| `formatting/fact_check.py` | 3-tier escalation (routine → risk → escalation), hardcoded web search bypass at line 87 — entire module is contrary to v2 design |
| `formatting/scheduler.py` | Adaptive rate-limit backpressure for hundreds of calls; v2 makes ~32 calls per deck and uses a fixed-size ThreadPoolExecutor |
| `formatting/choice_randomization.py` | Native pack export already does deterministic seeded shuffle (`export/native_quail_export.py:99-130`) — the AI-pass version is duplicate work |
| `formatting/cache_store.py` | Coupled to `fact_check.py`; v2 uses simple per-stage content-addressed caches |
| `formatting/prompt_builder.py` | Subsumed by v2 detection + rewrite adapters |
| `formatting/response_parser.py` | Subsumed by v2 detection + rewrite adapters |
| `export/usmle_formatter.py` | Replaced by Stage 3 (`providers/v2/openai_rewrite.py`) |
| `export/quail_export.py` | Legacy flat HTML export; the app loads native packs only |
| `export/quail_repair.py` | One-off image-repair tool for the legacy HTML output |
| `review/` (whole directory) | Terminal review UI; not in `--full-pipeline` and not in v2. Reintroduce as a separate tool if needed. |
| `app/workflows.py` | Master orchestration replaced by `app/v2_pipeline.py` |
| `app/job_runner.py` | Job-planning ceremony unnecessary at v2's smaller scope |
| `core/job_runner.py`, `core/job_planner.py`, `core/job_models.py` | Same as above — replaced by direct calls in `v2_pipeline.py` |
| `templates/` | HTML templates only used by the legacy `quail_export.py` |
| `archive_run.py` | Tied to the legacy run-archive workflow; v2 keeps stage outputs in `output/` for cache reuse |
| `convert_to_quail.py` | Standalone export tool that duplicates `--export-quail`; v2's export is invoked from `v2_pipeline.py` |
| `md_to_pdf.py` | Standalone utility unrelated to the pipeline |

## Domain model fields to delete (in `domain/models.py`)

The old `ExtractedQuestion` and `USMLEQuestion` classes are replaced by new
`RawSlide`, `DetectedQuestion`, and `RewrittenQuestion` models. The following
fields exist today on `ExtractedQuestion` but are never read by the native
pack exporter and are not part of the v2 contract:

- `correct_answer_text` — never read by export
- `proposed_correct_answer`, `proposed_correct_answer_text` — adjudication
  scaffolding, not exported
- `extraction_method`, `flags` — pipeline metadata; not in native pack
- `is_valid_question` — internal normalization
- `raw_model_payload`, `raw_model_text` — debug only
- `slide_consensus_status`, `validation` — never accessed
- `fact_check` — fact-check is gone in v2
- `review_status`, `review_reasons` — review UI is gone

## CLI flags to remove (from `main.py`)

| Flag | Reason |
| --- | --- |
| `--repair-quail-dir`, `--repair-output-dir` | Legacy HTML repair |
| `--run-two-sequential`, `--rotations` | Legacy batch mode that double-fed the formatter |
| `--export-quail`, `--full-pipeline` | Replaced by the default v2 flow |
| `--format-usmle` | No separate format step in v2 (detect + rewrite are one stream) |
| `--review` | Review UI is gone; reintroduce as a standalone tool if needed |
| `--openai-web-search`, `--no-openai-web-search` | No web search in v2, anywhere |
| `--archive-current-format-state`, `--no-archive-current-format-state` | Tied to fact-check archival, irrelevant in v2 |
| `--formatter-provider` | Only `"openai"` is supported; keep `--openai-model` for explicit override |
| `--quail-source-json`, `--quail-output-dir`, `--quail-images-dir`, `--quail-append` | Tied to the legacy export pipeline |
| `--reprocess-slide`, `--reprocess-question` | Append/repair semantics; v2 cache-by-content-hash makes these unnecessary |
| `--only-new`, `--only-failed`, `--append-native` | Same as above |
| `--dry-run-cost` | v2 prints estimated cost upfront from a deterministic calculation, no dry-run mode needed |
| `--all-time-stats` | Cumulative-stats reporting is dropped along with the HTML stats reports |

## Tests to keep

| Path | Reason |
| --- | --- |
| `tests/test_native_quail_export.py` | Guards the native pack export contract — v2 must keep passing this |
| `tests/test_native_contract.py` | Schema validation against `shared/native-contracts/quail-ultra-qbank/v1/*.schema.json` |
| `tests/test_pptx_parser*.py` | Stage 1 reuses `parsers/pptx_parser.py`; tests stay |
| `tests/test_google_api*.py` | Stage 1 reuses `parsers/google_api.py`; tests stay |

## Tests to delete

| Path | Reason |
| --- | --- |
| `tests/test_fact_check_policy.py` | Fact-check is gone |
| `tests/test_two_sequential_pipeline.py` | Mode is gone |
| `tests/test_quail_repair.py` | Utility is gone |
| Any test importing from a deleted module | Cascade delete |

## Stats subsystem

- Keep: a single JSON line at end of run with
  `{ai_calls, prompt_tokens, completion_tokens, est_cost_usd, duration_seconds}`.
- Delete: `stats/report_generator.py` (HTML output nobody reads),
  `stats/cumulative.py` (all-time totals tracking),
  `stats/pricing.py` is reused by the new lightweight cost printer.

## What gets KEPT (non-exhaustive)

The following modules stay as-is and are reused by the v2 pipeline:

- `parsers/google_api.py` — Slides download, comment fetch
- `parsers/pptx_parser.py` — PPTX text/notes/highlights/images
- `ai/rotation_prompts.py` — `normalize_rotation_name`, `CANONICAL_ROTATIONS`
- `ai/rotation_prompt_templates/*.txt` — rotation master prompts (the accuracy lever)
- `export/native_quail_export.py` — pack writer (deterministic choice randomization, content hashing, media copy)
- `export/native_contract.py` — schema validation
- `export/native_pack_state.py` — pack state management
- `storage/run_repository.py` — JSON I/O helpers
- `app/extraction_service.py:33-62` — slide-anchored comment filter (extract this helper, drop the rest of the file)
- `domain/models.py` `SlideContent` class (used by `parsers/pptx_parser.py`)
