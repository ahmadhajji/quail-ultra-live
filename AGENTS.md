# AGENTS

## Why This File Exists

Keep this file minimal.

- Put only repo-specific facts, constraints, and approval boundaries here.
- Do not restate generic Codex behavior beyond this repo's specific workflow.
- Remove stale branch notes, temporary goals, and implementation history when they stop being useful.

## Product

Quail Ultra Live is a web-first Quail fork for USMLE-style question solving.

- Preserve Study Pack and qbank compatibility.
- Keep the solving flow UWorld-inspired without copying branding or proprietary assets.
- Favor stable, incremental changes over rewrites.

## Repo Reality

- This repo is the web app, not the old Electron desktop app.
- Current stack is Express on the server plus Vite/React/TypeScript in the browser.
- Production target is Railway with SQLite on a mounted volume and S3-compatible bucket storage.
- Legacy desktop assumptions are reference material only unless the user explicitly asks for them.

## QBank Compatibility

- The parser is embedded in this repo as `tools/qbank-parser` (v2, Python-based).
- Source of truth for the folder structure and accepted qbank format: `docs/qbank-format.md`
- Any change to import rules, qbank parsing, metadata expectations, or rendered question/explanation behavior should be checked against the parser output contract as well as the app.

## Workflow

Preferred repo workflow:

1. User asks Codex for a change.
2. Codex makes the change on a dedicated branch for that edit.
3. Codex runs code-level checks.
4. Codex runs browser interaction tests and captures evidence when useful, such as screenshots of the changed UI.
5. Codex commits and pushes the branch.
6. Codex gets the branch ready for a Railway staging or temporary review deployment when needed.
7. User opens the deployment link and tests manually.
8. After explicit user approval, Codex opens a PR from the feature branch into `main` and lets CI run.
9. User reviews the PR and merges it.

## Approval Boundaries

- Preserve dirty worktrees and do not discard existing local changes unless the user explicitly asks.
- Do not merge to `main` without explicit user approval.
- Do not deploy production without explicit user approval.
- Prefer one focused branch per requested edit, usually `codex/<short-name>`.

## Deployment Facts

- app host: Railway
- relational data: SQLite on a Railway volume
- pack storage: Railway Bucket (S3-compatible)
- DNS: Cloudflare for `quail.clinicalvault.me`
- required env: `QUAIL_STORAGE_BACKEND=railway`, `QUAIL_DATA_DIR=/data`, `SESSION_SECRET`, `ALLOW_REGISTRATION`, plus either `S3_ENDPOINT`/`S3_REGION`/`S3_BUCKET`/`S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY` or Railway Bucket's injected `AWS_ENDPOINT_URL`/`AWS_DEFAULT_REGION`/`AWS_S3_BUCKET_NAME`/`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`
