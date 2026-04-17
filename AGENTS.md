# AGENTS

## Purpose

Quail Ultra keeps Quail's original desktop Electron architecture and BYO question-bank format, but reshapes the product around a more UWorld-like USMLE solving flow.

The current branch goal is:

- preserve Quail compatibility and stability
- keep the existing local qbank format and Electron + jQuery stack
- emulate UWorld's desktop Tutor / Timed workflow more closely
- stay visually inspired by UWorld without copying branding or proprietary assets

## Current Branch

- Repo target: `ahmadhajji/quail-ultra-live`
- Default branch: `main`
- Current checked-out branch when this note was updated: `main`

## Repo Reality Check

This repository is not the original Electron desktop app.

- `quail-ultra` is the upstream desktop-oriented line.
- `quail-ultra-live` is the account-backed web fork.
- This repo keeps the same qbank format and broad solving flow, but runs as:
  - Express on the server
  - jQuery/HTML/CSS in the browser
  - SQLite plus on-disk files under `data/`

Agents should not assume Electron packaging or desktop-only persistence when working in this repo.

## Architecture

Quail Ultra Live is a browser app backed by an Express server.

- `server/index.js`
  Main server entry point, auth/session setup, Study Pack import/export routes, pack asset serving, progress API, and folder-import session handling.
- `shared/`
  Qbank compatibility helpers and progress normalization shared across the web flow.
- `web/`
  Browser app pages, shared JS utilities, service worker, and CSS.

- `main.js`
  Legacy desktop entry point kept for compatibility/reference from the original line, not the deployed web server.
- `newblock.html` / `newblock.js`
  Block builder and session creation flow.
- `examview.html` / `examview.js`
  Solving screen, Tutor/Timed/Untimed state machine, highlighting, explanation reveal, timer behavior, pane launching.
- `previousblocks.html` / `previousblocks.js`
  Resume and review history table.
- `overview.html` / `overview.js`
  Aggregate stats and qbank reset controls.
- `quail-ui.css`
  Shared UI layer for the new builder, overview, previous blocks, and exam screens.

The app still depends on the original qbank assets:

- `index.json`
- `tagnames.json`
- `choices.json`
- `groups.json`
- `panes.json`
- per-question `*-q.html` and `*-s.html` files

## Data Model Changes

Progress remains in `progress.json`, but block records are now normalized to include newer fields while still reading legacy saves.

Each block record may now include:

- `mode: 'tutor' | 'timed' | 'untimed'`
- `questionStates`
- `reviewLayout: 'split' | 'stacked'`

Each `questionStates[i]` currently tracks:

- `submitted`
- `revealed`
- `correct`
- `eliminatedChoices`

Legacy compatibility is handled in `main.js` by:

- `deriveBlockMode`
- `normalizeBlockRecord`
- `normalizeProgress`

These functions infer sensible defaults from older fields such as:

- `timelimit`
- `showans`
- `answers`
- `complete`

Important persistence notes:

- older progress files should load without migration failure
- block keys are now created with `getNextBlockKey()` so deleted block IDs are not reused accidentally
- progress writes are centralized through `saveProgressToDisk()`

## Implemented UWorld-Style Changes

### 1. Block Builder

The builder was rewritten around explicit study modes.

- `Tutor`
  Immediate explanation after submission.
- `Timed`
  Countdown behavior and no explanation until block completion.
- `Untimed`
  No countdown, but explanations stay hidden until the block is ended.

Other builder changes:

- pool selection is organized around practical study modes such as unseen, incorrect, flagged, full bank, and custom IDs
- sequential ordering remains available as an advanced compatibility control
- custom ID lists are still supported
- grouped-question behavior is preserved
- builder UI is more structured and mode-forward than upstream Quail

### 2. Exam Screen

The exam screen is no longer the old two-column Quail layout. It now behaves as a continuous solving page.

Current exam behavior:

- compact top utility bar
- persistent question rail on the left
- continuous question -> answers -> explanation page flow
- Tutor reveal loop on the same page
- explanation panel hidden until appropriate for the block mode
- per-question status styling in the rail
- flagging preserved
- optional pane launch buttons preserved
- multicolor text highlighting preserved and persisted
- eliminate / restore controls for answer choices

Question rendering changes:

- answer text is extracted from the loaded question HTML
- duplicated `A) / B) / C)` answer blocks are stripped from the displayed stem so choices only appear in the answer section
- question assets and explanation assets still resolve from the qbank path

### 3. Tutor Flow

Tutor mode now works as:

1. enter question
2. select answer
3. submit answer
4. lock answer
5. reveal explanation immediately
6. review on the same page
7. advance when ready

Tutor-specific timer behavior:

- timer runs while the current question is unresolved
- timer freezes once the question is submitted and revealed
- timer resumes when the user moves to the next unresolved question

### 4. Timed and Untimed Flow

Timed and Untimed now both defer explanations until the end of the block.

- `Timed`
  Shows time remaining and auto-finishes if time expires.
- `Untimed`
  Shows elapsed time without countdown pressure.

When the block ends:

- the same screen flips into review mode
- all questions become revealed
- correctness is computed and stored
- the rail reflects correct / incorrect states

### 5. Previous Blocks and Overview

Secondary surfaces were updated so the new block modes make sense.

`previousblocks` now shows:

- session mode
- completed vs paused state
- review vs resume action labels

`overview` now tracks:

- completed blocks
- paused blocks
- tutor blocks
- timed blocks
- untimed blocks
- average time
- total time
- correct / incorrect / seen / flagged counts

The reset button styling in `overview.html` was also fixed to avoid clipping.

## Key Functions To Know

In `main.js`:

- `deriveBlockMode`
- `normalizeBlockRecord`
- `normalizeProgress`
- `getNextBlockKey`
- `saveProgressToDisk`

In `newblock.js`:

- mode selection and persistence
- qpool selection and filtering
- grouped-question handling
- custom ID parsing
- block summary rendering

In `examview.js`:

- `renderHeader`
- `renderQuestionList`
- `renderQuestionMeta`
- `renderExplanationMeta`
- `createAnswerChoiceButtons`
- `extractChoiceLabels`
- `stripChoicesFromQuestionDisplay`
- `syncTimerState`
- `populatePanes`
- `finishBlock`

## Visual Direction

The current visual system aims to be simpler and flatter than the earlier card-heavy pass.

Current direction:

- compact blue utility bar
- slimmer left question rail
- larger white solving canvas
- flatter answer rows
- reduced gradients and shadow depth

This is intentionally closer to UWorld's utilitarian desktop style than to decorative dashboard UI.

## Constraints

Do not break these:

- qbank file compatibility
- grouped-question sequencing
- pane support
- resume / review continuity for older progress files
- existing Electron/jQuery architecture

Do not do these unless explicitly requested:

- rewrite into React/Vue
- change the qbank authoring format
- remove pane support
- introduce UWorld branding or copied proprietary assets

## Known Gaps / Next Likely Work

The branch is functional, but still not full parity.

Expected next refinement areas:

- more UWorld-like spacing and typography polish
- tighter option-row interaction styling
- better rail/status density and icon treatment
- more exact toolbar affordances
- more robust stripping for unusual qbank question markup patterns
- more manual pass-through testing on real question banks

Not implemented in this branch:

- notebook integration
- flashcards
- searchable explanation archive
- peer comparison analytics
- mobile-specific layout work

## Run And Verify

Install and run:

```bash
npm install
npm start
```

Useful checks:

```bash
curl http://localhost:3000/api/health
node --check main.js
node --check newblock.js
node --check examview.js
node --check previousblocks.js
node --check overview.js
npm run check
```

For this repo, the most relevant manual smoke path is the web flow:

1. Register or sign in.
2. Import a Study Pack folder or zip.
3. Open the pack.
4. Start a Tutor block and confirm immediate explanation reveal.
5. Start a Timed or Untimed block and confirm explanations stay hidden until block finish.
6. Open Previous Blocks and verify resume/review continuity.
7. Open Overview and confirm stats update.

Packaging:

```bash
npm run build:mac-arm64-manual
npm run build:win-x64
```

Manual smoke path:

1. Start a Tutor block.
2. Select an answer.
3. Submit and confirm the explanation reveals on the same page.
4. Confirm the Tutor timer freezes while reviewing the revealed question.
5. Advance to the next unresolved question and confirm the timer resumes.
6. Start a Timed block and confirm explanations remain hidden until finish.
7. End the block and confirm review mode stays on the exam screen.
8. Reopen the session from Previous Blocks and confirm continuity.

## Editing Guidance For Future Agents

- Prefer `rg` for code search.
- Use `apply_patch` for manual edits.
- Treat this repo as the web deployment project first; do not blindly follow Electron-only assumptions from upstream.
- Do not rewrite the app into a framework.
- Preserve backward compatibility for `progress.json`.
- Treat `quail-ui.css` as the shared styling layer for the new UI.
- Keep the exam screen focused on desktop use.
- When adjusting timer behavior, verify Tutor, Timed, Untimed, pause, resume, and finished-block states separately.
- When changing answer rendering, test against real `*-q.html` files because choice text may be embedded in the question stem markup.

## Codex Workflow Rules

This repo should support a simple solo vibe-coding loop with Codex.

Core rule:

- user talks to Codex
- Codex implements change on feature branch
- Codex runs local automated checks
- Codex opens local app for manual user review when asked
- user explicitly approves
- Codex pushes branch, opens PR, waits for CI
- user explicitly approves deploy
- Codex deploys production from merged `main`

Do not skip those approval boundaries:

- do not deploy to production without explicit user approval
- do not merge to `main` without explicit user approval
- do not discard uncommitted work unless user explicitly asks

If working tree is already dirty:

- preserve current work
- do not switch branches blindly
- if needed, checkpoint current work first on current branch

If working tree is clean and user starts a new feature:

- create a feature branch first
- branch naming should default to `codex/<short-feature-name>`

## Simple User Intents

Future agents in this repo should interpret these user requests like this:

### 1. "Implement feature ..." / "Make navbar blue" / "Change X"

Expected agent behavior:

1. inspect current branch and working tree
2. create feature branch if safe and needed
3. implement requested change
4. run:

```bash
npm run check
npm run test:smoke:local
```

5. report what changed and whether checks passed
6. stop there unless user asks to test locally, ship, or deploy

### 2. "Test local" / "Open local" / "Let me test it"

Expected agent behavior:

1. first run automated checks:

```bash
npm run check
npm run test:smoke:local
```

2. if green, start local app for manual review
3. open browser to local app for user
4. do not commit, merge, or deploy yet

Preferred local review flow:

```bash
npm run dev
```

Then open:

```bash
http://127.0.0.1:3000
```

If a lighter server-only preview is better:

```bash
npm run build
npm run start:server
```

Then open same local URL.

### 3. "Looks good" / "Feature done" / "Take next step"

Expected agent behavior:

1. summarize current diff
2. commit on feature branch
3. push branch to GitHub
4. open PR into `main`
5. tell user CI is running
6. wait for PR checks to pass before merge

### 4. "Ship it" / "Merge it"

Expected agent behavior:

1. confirm PR exists
2. confirm CI is green
3. merge PR into `main`
4. pull/sync local `main` if needed
5. stop before production deploy unless user also approved deploy

### 5. "Deploy" / "Deploy production" / "Push live"

Expected agent behavior:

1. confirm change is already merged into `main`
2. confirm latest `main` CI is green
3. deploy production
4. run production health check
5. report live result

Production deploy should now prefer Vercel production deployment from merged `main`.
Fallback is a manual Vercel dashboard/CLI deployment, not a server SSH deploy.

## Required Local Checks

Before a feature is handed back for review, future agents should run:

```bash
npm run check
npm run test:smoke:local
```

What they cover:

- `npm run check`
  - TypeScript typecheck
  - JS syntax checks
  - Vitest unit/integration tests
- `npm run test:smoke:local`
  - production build
  - local Express server boot
  - Playwright browser smoke tests

Manual review still matters after automated checks.

## Git And PR Flow

Solo safe flow for this repo:

1. start from latest `main`
2. create feature branch
3. make change
4. run local automated checks
5. open local app for manual review when user asks
6. user approves feature
7. commit feature branch
8. push feature branch
9. open PR into `main`
10. let CI run
11. if CI passes and user approves, merge PR
12. if user approves deploy, deploy latest `main`

Useful commands:

```bash
git switch main
git pull --ff-only origin main
git switch -c codex/<feature-name>
git status
git add -A
git commit -m "Short clear message"
git push -u origin codex/<feature-name>
```

## CI/CD Expectations

Repo CI should protect both PRs and `main`.

Expected GitHub Actions:

- `CI`
  - `Validate`
  - `Browser Smoke`
- `Deploy Production`
  - Vercel production deploy from `main`

Future agents should prefer this deploy order:

1. PR CI green
2. merge to `main`
3. `main` CI green
4. deploy on Vercel

`main` should stay branch-protected:

- no direct pushes
- PR required
- CI checks required before merge

Production deploys should not depend on a mutable server checkout anymore.

## Deployment Target

Primary production target:

- host app on Vercel
- store relational data in Neon Postgres
- store Study Pack files in private Vercel Blob
- keep `quail.clinicalvault.me` on Cloudflare DNS and point it to Vercel

Required production environment variables:

- `SESSION_SECRET`
- `DATABASE_URL`
- `BLOB_READ_WRITE_TOKEN`
- `ALLOW_REGISTRATION`

Migration workflow:

1. stop writes on the old homelab deployment
2. back up the old `data/` directory outside the repo
3. pull the snapshot locally
4. run `npm run migrate:cloud`
5. deploy to Vercel
6. verify `api/health`, login, pack open, progress save, and export
7. repoint `quail.clinicalvault.me` in Cloudflare to Vercel
8. retire the old tunnel/server path after validation

The old homelab deployment at `10.5.5.10` is now legacy rollback infrastructure, not the primary deploy target.
