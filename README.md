# Quail Ultra Live

Quail Ultra Live is the account-backed web fork of Quail Ultra. It keeps the original qbank format and the same block-building and solving flow, but moves the product into a browser app with sign-in, Study Pack import/export, and local-first sync.

## What This Repo Contains

- `server/`
  Express server for auth, Study Pack import/export, qbank asset serving, and progress persistence.
- `shared/`
  Qbank compatibility and progress helpers extracted from the desktop app logic.
- `web/`
  Browser version of the Quail Ultra UI, still based on HTML, CSS, jQuery, and the existing page flow.

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
npm start
```

The server runs on `http://localhost:3000`.

Useful check:

```bash
npm run check
npm run test:smoke:local
```

Standing project tracker:

- [Product Roadmap And Change Tracker](ROADMAP.md)

Step-by-step workflow and CI/CD notes:

- [Development Workflow](docs/development-workflow.md)

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

Expose the container through your preferred reverse proxy or Cloudflare Tunnel.

## Notes

- Session storage uses the default in-memory Express session store in this initial cut. Restarting the container signs users out, but saved Study Pack data remains because it is stored on disk and in SQLite under `data/`.
- Offline behavior is local-first for cached packs and queued progress updates. Study Pack file warming happens in the background once a pack is opened online.
- The desktop Electron repo remains the reference line; this repo is the separate web conversion project.
