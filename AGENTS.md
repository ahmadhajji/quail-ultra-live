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

## Deployment Runbook

The current production deployment is the Debian homelab instance exposed through Cloudflare Tunnel.

### SSH Access

- Host: `10.5.5.10`
- User: `ahmad`
- SSH command: `ssh ahmad@10.5.5.10`
- Auth is currently password-based.
- Do not commit or write the plaintext password into tracked files. Retrieve it from the user or a secure local secret source when needed.

### Server Paths

- App checkout: `/home/ahmad/apps/quail-ultra-live`
- Persistent app data: `/home/ahmad/apps/quail-ultra-live/data`
- Server env file: `/home/ahmad/apps/quail-ultra-live/.env`
- Cloudflare Tunnel config: `/etc/cloudflared/config.yml`

### Docker Deployment

The server deploy is Compose-based.

From `/home/ahmad/apps/quail-ultra-live`:

```bash
git pull
docker compose up -d --build
docker compose logs -f --tail=200
```

Important runtime details:

- `compose.yaml` binds the app to `127.0.0.1:${PORT:-3000}:3000`
- persistent files live in `./data`
- required env values:
  - `SESSION_SECRET`
  - `ALLOW_REGISTRATION`
  - `PORT`

Recommended production flow:

1. Keep `ALLOW_REGISTRATION=true` only long enough to create the first account.
2. Flip it to `false` in `.env`.
3. Re-run `docker compose up -d`.

### Health Checks

Useful checks on the server:

```bash
curl http://127.0.0.1:3000/api/health
docker compose ps
docker compose logs --tail=200
```

Useful checks from elsewhere:

```bash
curl https://quail.clinicalvault.me/api/health
```

### Cloudflare Tunnel

The public hostname is:

- `https://quail.clinicalvault.me`

The tunnel ingress must forward to the local app and keep chunked encoding disabled for uploads.

Relevant ingress shape in `/etc/cloudflared/config.yml`:

```yaml
ingress:
  - hostname: quail.clinicalvault.me
    service: http://localhost:3000
    originRequest:
      disableChunkedEncoding: true
  - service: http_status:404
```

After changing the tunnel config:

```bash
sudo cloudflared tunnel ingress validate /etc/cloudflared/config.yml
sudo systemctl restart cloudflared
sudo systemctl --no-pager --full status cloudflared
```

### Upload Caveat

For this deployment, `disableChunkedEncoding: true` is not optional.

Without it, multipart folder uploads through Cloudflare Tunnel can stall on the first batch even when the origin app is healthy. This was the root cause of the public upload failure for the real test bank at:

- `/Users/ahmadhajji/Documents/IM1-quail-qbank`

That bank was later verified to upload successfully through the live public endpoint after the tunnel change.

## Current Working Tree Note

At the time this file was updated:

- repo remote was `git@github.com:ahmadhajji/quail-ultra-live.git`
- default branch was `main`
- public deployment was live at `quail.clinicalvault.me`
- folder upload batching and async finalization had been added for public imports
- Cloudflare Tunnel required `disableChunkedEncoding: true` for reliable multipart uploads
