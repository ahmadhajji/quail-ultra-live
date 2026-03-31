# Quail Ultra Live

Quail Ultra Live is a React and Express web service for working through Quail-compatible study packs in the browser. It keeps the original qbank format and solving flow, but the app itself is now a live web product rather than a desktop package.

## What This Repo Contains

- `frontend/`
  Vite and React app entrypoints, pages, shared client logic, and public assets that build into `dist/`.
- `server/`
  Express server for auth, Study Pack import/export, qbank asset serving, and progress persistence.
- `shared/`
  Shared qbank compatibility and progress helpers used by both the server and the React client.

## Core Product Model

- User-facing upload/export unit: `Study Pack`
- A Study Pack still contains the Quail-compatible bank files:
  - `index.json`
  - `tagnames.json`
  - `choices.json`
  - `groups.json`
  - `panes.json`
  - `progress.json`
  - question/solution HTML files
- Imports accept:
  - folder uploads
  - zip uploads
- Exports currently download as zip archives

## Local Development

```bash
npm install
npm run dev
```

The local app serves on `http://localhost:3000`.

For a production-style local run:

```bash
npm start
```

Useful checks:

```bash
npm run check
npm test
```

## Deployment

Primary target is a Debian host using Docker and a persistent volume for `data/`.

Build and run locally with Compose:

```bash
docker compose up --build
```

Recommended environment variables:

- `SESSION_SECRET`
- `ALLOW_REGISTRATION`
- `PORT`

Expose the service through your preferred reverse proxy or Cloudflare Tunnel.

## Notes

- Session storage uses the default in-memory Express session store in this initial cut. Restarting the container signs users out, but saved Study Pack data remains because it is stored on disk and in SQLite under `data/`.
- Offline behavior is local-first for cached packs and queued progress updates. Study Pack file warming happens in the background once a pack is opened online.
- Desktop Electron packaging and release artifacts are intentionally not part of this repo anymore.
