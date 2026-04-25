# Testing Guide

## Test Layers
- Unit tests: validate focused modules and helper contracts.
- Integration tests: exercise CLI/service seams with mocked providers.
- Smoke checks: validate key documentation commands still execute.

## Fixtures and Golden Data Policy
- Prefer minimal fixtures that isolate one behavior per test.
- Golden comparisons should assert semantic fields (`question_id`, `choices`, `correct_answer`, tags) rather than brittle full-string snapshots.
- Keep fixture inputs deterministic and API-independent.

## Non-Flaky Integration Patterns
- Mock provider adapters instead of live API calls.
- Use temporary directories for output/caches.
- Avoid wall-clock timing assertions unless using fake clocks.

## Standard Validation Commands
- `pytest -q`
- `ruff check .`
- `ruff format --check .`
- `mypy main.py app domain storage providers formatting qbank_cli.py`
- `python3 -m build`

## Docs Command Smoke Script
- Script: `docs/scripts/smoke_commands.sh`
- Coverage:
  - `python3 main.py --help`
  - `python3 main.py --status`

Run manually:
- `bash docs/scripts/smoke_commands.sh`
