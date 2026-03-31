# AGENTS

## Purpose

Quail Ultra Live is the account-backed React web fork of Quail. It preserves the Quail question-bank format and solving flow, but the product in this repo is a browser app backed by Express, not an Electron desktop package.

## Architecture

- `frontend/`
  Vite + React entrypoints, pages, shared client logic, and public assets.
- `server/index.js`
  Express server entrypoint, auth/session setup, Study Pack import/export routes, pack asset serving, and progress APIs.
- `shared/`
  Qbank compatibility helpers and progress normalization shared across the web app.
- `data/`
  Runtime SQLite database and uploaded Study Pack workspaces.

The app still depends on Quail-compatible qbank assets such as `index.json`, `tagnames.json`, `choices.json`, `groups.json`, `panes.json`, `progress.json`, and per-question `*-q.html` / `*-s.html` files.

## Product Constraints

Do not break these:

- qbank file compatibility
- grouped-question sequencing
- pane support
- resume and review continuity for older `progress.json` files
- Tutor, Timed, and Untimed block behavior

Do not assume any Electron packaging, IPC, desktop storage path, or legacy jQuery page code still matters in this repo.

## Editing Guidance

- Prefer `rg` for search.
- Use `apply_patch` for manual edits.
- Keep changes aligned with the React frontend and Express server architecture already in the repo.
- Preserve backward compatibility in `shared/progress.js` and `shared/qbank.js`.
- When changing timer or review behavior, test Tutor, Timed, Untimed, paused, resumed, and finished-block states separately.
- When changing question rendering, test against real qbank HTML because answer labels may be embedded in the question stem markup.

## Run And Verify

Install and run:

```bash
npm install
npm run dev
```

Useful checks:

```bash
curl http://localhost:3000/api/health
npm run build
npm run check
```

Relevant manual smoke path:

1. Register or sign in.
2. Import a Study Pack folder or zip.
3. Open the pack.
4. Start a Tutor block and confirm immediate explanation reveal.
5. Start a Timed or Untimed block and confirm explanations stay hidden until block completion.
6. Open Previous Blocks and verify resume/review continuity.
7. Open Overview and confirm stats update.

## Deployment

The production deployment is the Debian homelab instance behind Cloudflare Tunnel.

- Host: `10.5.5.10`
- User: `ahmad`
- App checkout: `/home/ahmad/apps/quail-ultra-live`
- Persistent app data: `/home/ahmad/apps/quail-ultra-live/data`
- Env file: `/home/ahmad/apps/quail-ultra-live/.env`
- Tunnel config: `/etc/cloudflared/config.yml`

Deploy from `/home/ahmad/apps/quail-ultra-live`:

```bash
git pull
docker compose up -d --build
docker compose logs -f --tail=200
```

Useful health checks:

```bash
curl http://127.0.0.1:3000/api/health
curl https://quail.clinicalvault.me/api/health
docker compose ps
docker compose logs --tail=200
```

Cloudflare Tunnel must keep `disableChunkedEncoding: true` for reliable multipart folder uploads.
