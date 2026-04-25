# QBank Parser

QBank Parser extracts questions from Google Slides `.pptx` exports, reviews them in a terminal workflow, formats them into USMLE-style vignettes with OpenAI, and exports Quail-compatible qbank output.

## What It Does
- Parse slides and extract text, notes, highlighted answers, and embedded images.
- Run OpenAI-powered extraction with resumable progress and configurable parallel workers.
- Review extracted questions interactively (`confirm`, `edit`, `skip`).
- Format confirmed questions into USMLE-style output (`json`, `md`, optional `pdf`).
- Export formatted output into Quail qbank folder structure.
- Run a two-input sequential pipeline from Google Slides URLs/IDs.

## Requirements
- Python `>=3.10`
- OpenAI API key (`OPENAI_API_KEY`) for AI extraction/formatting
- Optional Google OAuth credentials for fetching slide comments

## Quick Start
```bash
# 1) Clone and enter repo
cd qbank-parser

# 2) Create virtual environment
python3 -m venv venv
source venv/bin/activate

# 3) Install dependencies
pip install -r requirements.txt -r requirements-dev.txt

# 4) (Optional, only needed for PDF generation)
playwright install chromium

# 5) Configure environment
cp .env.example .env
# then edit .env and set OPENAI_API_KEY
```

## Safe Codex Workflow
- Want talk-to-Codex workflow? Read [docs/development-workflow.md](docs/development-workflow.md).
- Short version:
  - ask `Implement feature: ...`
  - ask `Test local`
  - ask `Open local`
  - after approval say `Looks good, take next step`
  - say `Ship it` to merge
  - no separate deploy step in this repo

### Run Core Flow
```bash
# Extract questions from PPTX
python main.py data/your-slides.pptx

# OR run extraction directly from Google Slides share link
# (downloads PPTX in backend and uses the same file ID for comments)
python main.py --google-slides-link "https://docs.google.com/presentation/d/<FILE_ID>/edit"

# Review questions interactively
python main.py --review

# Format to USMLE style (JSON + Markdown, PDF attempted)
python main.py --format-usmle --formatter-provider openai

# Export formatted JSON to Quail qbank folder
python main.py --export-quail
```

## Terminal-Only Runtime
QBank Parser is terminal-only. Supported runtime is `python main.py ...`.

Legacy desktop/UI entrypoints such as `--gui`, Streamlit, PyInstaller bundles, DMGs, and Windows app zips are deprecated and no longer supported.

## Google Cloud Console Setup
Use this once to prepare OAuth credentials for terminal runs that fetch Google comments.

1. Open Google Cloud Console and create/select a project.
2. Enable APIs:
   - `Google Drive API`
   - `Google Slides API`
3. Go to `APIs & Services` -> `OAuth consent screen`.
4. Configure consent screen:
   - User type: `External` (or `Internal` for Workspace-only apps)
   - App name, support email, developer contact email
5. Add scopes:
   - `https://www.googleapis.com/auth/drive.readonly`
   - `https://www.googleapis.com/auth/presentations.readonly`
6. Add test users while app is in testing mode.
7. Go to `APIs & Services` -> `Credentials` -> `Create Credentials` -> `OAuth client ID`.
8. Choose application type: `Desktop app`.
9. Download the client JSON and point `GOOGLE_CREDENTIALS_PATH` at it, or place it at the default runtime path.

Notes:
- In testing mode, only listed test users can authenticate.
- For broad public distribution, Google may require OAuth app verification depending on scopes and user type.

## CLI Commands

### Main Commands
- `python main.py <file.pptx>`: extract questions from one presentation.
- `python main.py --google-slides-link <link_or_id>`: download Slides to PPTX in backend, then run extraction (comments use the same file ID).
- `python main.py --review`: interactive review of extracted questions.
- `python main.py --format-usmle`: format reviewed/extracted questions as USMLE vignettes.
- `python main.py --export-quail`: export USMLE JSON to Quail format.
- `python main.py --full-pipeline <file.pptx>`: run extract -> format -> Quail export in one command.
- `python main.py --run-two-sequential INPUT1 INPUT2`: run two Google Slides inputs through extraction -> formatting -> Quail export.
- `python main.py --status`: show config and run-state status.

### High-Value Options
- `--speed-profile {quality,balanced,fast}`
- `--workers N`
- `--checkpoint-every N`
- `--with-google-api`
- `--google-slides-link LINK_OR_ID`
- `--google-slides-id ID`
- `--formatter-provider {openai}`
- `--openai-model MODEL`
- `--openai-reasoning-effort {low,medium,high}`
- `--openai-web-search` / `--no-openai-web-search`
- `--openai-target-rpm N`
- `--openai-max-inflight N`
- `--archive-current-format-state` / `--no-archive-current-format-state`
- `--quail-source-json PATH`
- `--quail-output-dir PATH`
- `--quail-images-dir PATH`
- `--quail-append`
- `--dry-run`
- `--all-time-stats`

### Dry-Run Examples
```bash
# Preview extraction outputs without writing files
python main.py data/your-slides.pptx --dry-run

# Preview extraction from Google Slides share link
python main.py --google-slides-link "https://docs.google.com/presentation/d/<FILE_ID>/edit" --dry-run

# Preview formatting writes and archive moves
python main.py --format-usmle --dry-run

# Preview Quail fresh-mode cleanup + writes
python main.py --export-quail --dry-run
```

### Review Step
The review stage remains terminal-only:
```bash
python main.py --review
```

## Environment Variables
Copy `.env.example` to `.env` and set values as needed.

### Required
- `OPENAI_API_KEY`: required for AI extraction and formatting.

### Optional
- `OPENAI_EXTRACTION_MODEL` (default: `gpt-4.1-mini`)
- `OPENAI_FORMATTER_MODEL` (default: `gpt-5.4`)
- `OPENAI_REASONING_EFFORT` (default: `high`)
- `OPENAI_WEB_SEARCH` (default: `true`)
- `OPENAI_TARGET_RPM` (default: `450`)
- `OPENAI_MAX_INFLIGHT` (default: `120`)
- `FORMATTER_PROVIDER` (default: `openai`)
- `GOOGLE_SLIDES_ID`
- `GOOGLE_CREDENTIALS_PATH` (default: `credentials.json`)
- `GOOGLE_TOKEN_PATH` (default: `token.json` under runtime base dir)
- `QBANK_BASE_DIR` (override runtime workspace)

## Outputs
By default, output is written under `output/`.

### Extraction Stage
- `output/extracted_questions.json`
- `output/extracted_questions.csv`
- `output/extracted_images/`
- `output/extraction_progress.json` (resume checkpoints)

### Review Stage
- `output/reviewed_questions.json`

### Formatting Stage
- `output/usmle_formatted_questions.json`
- `output/usmle_formatted_questions.md`
- `output/usmle_formatted_questions.pdf` (if Playwright + Chromium available)
- `output/usmle_formatter_cache.json`
- `output/usmle_formatter_progress.json`
- `output/usmle_failed_questions.json` (only when formatting failures occur)

### Quail Export Stage
- `output/quail_qbank/` containing qbank files and assets

## Development
Run local quality checks before opening a PR:

```bash
pytest -q
ruff check .
ruff format --check .
mypy main.py app domain storage providers formatting qbank_cli.py
bash docs/scripts/smoke_commands.sh
python3 -m build
```

## Documentation
- [Architecture](docs/architecture.md)
- [Quail Ultra Live qbank delta note](docs/quail-ultra-live-qbank-delta.md)
- [Pipeline runbook](docs/runbooks/pipeline.md)
- [Testing guide](docs/testing.md)
- ADRs:
  - [ADR-001](docs/adr/ADR-001-domain-model-extraction.md)
  - [ADR-002](docs/adr/ADR-002-run-repository-boundary.md)
  - [ADR-003](docs/adr/ADR-003-provider-adapter-strategy.md)
  - [ADR-004](docs/adr/ADR-004-ci-quality-gates.md)

## Public Repo Notes
- Runtime artifacts in `archives/` and user-generated output in `output/` are intentionally not tracked.
- Secrets must stay in local `.env` and credential/token files.
- If you are publishing this repo after previous private use, rotate any previously used API/OAuth credentials.

## Contributing and Policies
- [Contributing guide](CONTRIBUTING.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Security policy](SECURITY.md)

## License
MIT. See [LICENSE](LICENSE).
