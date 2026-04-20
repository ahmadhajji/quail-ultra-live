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
- Production target is Vercel with Neon Postgres and Vercel Blob.
- Legacy desktop assumptions are reference material only unless the user explicitly asks for them.

## QBank Compatibility

- This app must stay aligned with the qbank parser/exporter repo so generated banks remain compatible.
- Local parser repo: `/Users/ahmadhajji/.gemini/antigravity/scratch/qbank-parser`
- GitHub parser repo: `https://github.com/ahmadhajji/qbank-parser`
- Source of truth for the folder structure and accepted qbank format in this repo: `docs/qbank-format.md`
- Parser-side note: `qbank-parser/docs/quail-ultra-live-qbank-delta.md` is a delta/backlog document, not the final standard.
- Any change to import rules, qbank parsing, metadata expectations, or rendered question/explanation behavior should be checked against the parser output contract as well as the app.

## Workflow

Preferred repo workflow:

1. User asks Codex for a change.
2. Codex makes the change on a dedicated branch for that edit.
3. Codex runs code-level checks.
4. Codex runs browser interaction tests and captures evidence when useful, such as screenshots of the changed UI.
5. Codex commits and pushes the branch.
6. Codex gets the branch ready for a Vercel preview deployment.
7. User opens the Vercel preview link and tests manually.
8. After explicit user approval, Codex opens a PR from the feature branch into `main` and lets CI run.
9. User reviews the PR and merges it.

## Approval Boundaries

- Preserve dirty worktrees and do not discard existing local changes unless the user explicitly asks.
- Do not merge to `main` without explicit user approval.
- Do not deploy production without explicit user approval.
- Prefer one focused branch per requested edit, usually `codex/<short-name>`.

## Deployment Facts

- app host: Vercel
- relational data: Neon Postgres
- pack storage: Vercel Blob
- DNS: Cloudflare for `quail.clinicalvault.me`
- required env: `SESSION_SECRET`, `DATABASE_URL`, `BLOB_READ_WRITE_TOKEN`, `ALLOW_REGISTRATION`
