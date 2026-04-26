# Contributing

## Development Setup
1. Clone the repository.
2. Create and activate a virtual environment.
3. Install dependencies:
   - `pip install -r requirements.txt -r requirements-dev.txt`
4. (Optional, for PDF generation) install Playwright browser runtime:
   - `playwright install chromium`

## Branching
- Create feature branches from `main`.
- Keep changes focused and small where possible.
- Use descriptive commit messages.

## Quality Checks
Run these before opening a pull request:

- `pytest -q`
- `ruff check .`
- `ruff format --check .`
- `mypy main.py app domain storage providers formatting qbank_cli.py`
- `bash docs/scripts/smoke_commands.sh`
- `python3 -m build`

## Pull Requests
- Explain what changed and why.
- Link any related issue.
- Include test updates for behavior changes.
- Update documentation (`README.md` / `docs/`) when CLI or workflow behavior changes.

## Scope Guidelines
- Do not commit secrets, tokens, or local environment files.
- Do not commit generated run artifacts under `archives/` or `output/`.
