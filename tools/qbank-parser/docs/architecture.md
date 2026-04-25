# Architecture

This document describes the current runtime architecture after incremental refactors (PR1-PR6).

## Goals
- Keep CLI behavior stable while improving internal boundaries.
- Isolate provider-specific logic from orchestration.
- Replace implicit filesystem coupling with typed contracts and explicit repositories.

## Component Boundaries
- `main.py`: CLI entrypoint and top-level command routing.
- `core/`: pure job contracts, validation, and deterministic dry-run planning.
- `adapters/`: side-effect adapters (`workflow_adapter`, `filesystem_adapter`).
- `app/`: orchestration services (`ExtractionService`, `StatusService`).
- `app/job_runner.py`: stable internal interface (`run_job(params) -> result`) shared by CLI and tests.
- `app/workflows.py`: workflow functions previously embedded in `main.py`.
- `domain/`: shared dataclasses (`ExtractedQuestion`, `SlideContent`, `USMLEQuestion`).
- `providers/`: external AI adapters (OpenAI extraction + formatting).
- `formatting/`: prompt building, response parsing, cache/progress helpers, scheduler.
- `storage/`: filesystem persistence boundary (`RunRepository`).
- `parsers/`: PPTX + Google Slides API ingestion.
- `review/`: terminal review workflow.
- `export/`: CSV/JSON/markdown/PDF/Quail export surfaces.

## Pipeline Sequence
1. Input ingestion from local PPTX or Google Slides share link (auto-exported to PPTX).
2. Slide parsing into `SlideContent` structures.
3. AI extraction into `ExtractedQuestion` structures.
4. Optional review edits/approval.
5. USMLE formatting into `USMLEQuestion` structures.
6. Export and artifact persistence.

## Data Contracts
- Extraction stage output contract: `list[ExtractedQuestion]` + extraction metadata.
- Formatting stage input contract: validated `ExtractedQuestion` list with stable IDs.
- Formatting stage output contract: `list[USMLEQuestion]` with deterministic ordering.
- Persistence contract: cache/progress and export artifacts are written atomically via `RunRepository`.

## Provider Strategy
- Current production formatter provider is OpenAI.
- Provider-specific request/response behavior is constrained to `providers/` adapters.
- Formatter orchestration in `export/usmle_formatter.py` delegates to `formatting/` modules.

## Operational Invariants
- CLI signatures in `main.py` are treated as backward-compatible interface.
- `run_job` is stable orchestration contract for terminal workflows and test integration.
- `dry_run=True` must never mutate repo/workspace artifacts.
- Question IDs must be unique before formatting.
- Resume/cache logic must not trigger duplicate API calls on cache hit.
- Stage outputs are persisted atomically to avoid partial-file corruption.
