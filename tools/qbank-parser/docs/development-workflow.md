# Development Workflow

This repo is set up for a safe solo workflow where you mostly talk to Codex and let GitHub Actions do the repeatable safety checks.

## What This Repo Is
- Python terminal app/script.
- Main command entrypoint: `python main.py`
- Supported runtime: terminal only. No supported UI or desktop bundle path.

## Simple Human Workflow
1. Ask Codex to build or change something.
2. Codex works on a feature branch, makes code changes, and runs local checks.
3. You can ask for manual local CLI testing if you want to try exact commands.
4. When you approve, Codex commits, pushes, and opens PR.
5. GitHub Actions runs CI on the branch/PR.
6. When PR is green and you approve, Codex merges to `master`.

## Phrases To Use With Codex
- `Implement feature: <what you want>`
- `Test local`
- `Open local`
- `Looks good, take next step`
- `Ship it`

## What Each Phrase Does

### `Implement feature: ...`
Codex should:
- inspect repo and current git state
- create/use a feature branch
- implement change
- run relevant automated checks
- tell you what changed and what still needs approval

### `Test local`
Codex should run full local gate:

```bash
ruff check .
ruff format --check .
mypy main.py app domain storage providers formatting qbank_cli.py
pytest -q
bash docs/scripts/smoke_commands.sh
python3 -m build
```

### `Open local`
Use this when you want to manually try exact CLI behavior.

For CLI-focused work, Codex should run task-specific commands instead, such as:

```bash
python main.py --help
python main.py --status
python main.py data/your-slides.pptx --dry-run
```

### `Looks good, take next step`
Advance one gate only:
- not pushed yet: commit, push, open PR
- PR already open and green: merge PR
- already merged: stop and report merged state

### `Ship it`
Merge approved green PR into `master`.

Important:
- Repo has no separate deploy step.

## CI Checks
GitHub Actions CI runs:
- `ruff check .`
- `ruff format --check .`
- `mypy main.py app domain storage providers formatting qbank_cli.py`
- `pytest -q`
- `bash docs/scripts/smoke_commands.sh`
- `python -m build`

## GitHub Safety Rules
- Use feature branches.
- Open PR before merge.
- Keep `master` protected.
- Merge only after CI passes.
