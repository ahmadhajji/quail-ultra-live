# Quail Ultra Live

Quail Ultra Live is the account-backed web fork of Quail Ultra. It keeps the original qbank format and the same block-building and solving flow, but moves the product into a browser app with sign-in, Study Pack import/export, and local-first sync.

## What This Repo Contains

- `server/`
  Express server for auth, Study Pack import/export, qbank asset serving, and progress persistence.
- `shared/`
  Shared TypeScript domain, qbank compatibility, and progress helpers used by both the server and browser app.
- `frontend/`
  Single-page React + TypeScript browser app built with Vite, including public branding assets and the service worker source.

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

Primary target is Vercel for hosting, with Neon Postgres for relational data and a private Vercel Blob store for Study Pack files.

Recommended production environment variables:

- `SESSION_SECRET`
- `DATABASE_URL`
- `BLOB_READ_WRITE_TOKEN`
- `ALLOW_REGISTRATION`

Vercel config lives in [vercel.json](/Users/ahmadhajji/.gemini/antigravity/scratch/quail-ultra-live/vercel.json).

Local development still defaults to the local filesystem + SQLite backend. To bootstrap an admin locally without the old runtime auto-seed, set:

```bash
export LOCAL_BOOTSTRAP_ADMIN_USERNAME=ahmad
export LOCAL_BOOTSTRAP_ADMIN_PASSWORD=secret
```

Migration and cutover notes live in [docs/vercel-cutover.md](/Users/ahmadhajji/.gemini/antigravity/scratch/quail-ultra-live/docs/vercel-cutover.md).

## Notes

- Auth now uses a signed HttpOnly cookie instead of the in-memory Express session store.
- Local mode stores packs on disk and relational data in SQLite under `data/`.
- Cloud mode stores packs in private Vercel Blob and relational data in Neon Postgres.
- Cloud imports use direct browser-to-Blob uploads to avoid Vercel Function body limits, and zip exports are built in the browser from the authenticated manifest + file endpoints.
- Offline behavior is local-first for cached packs and queued progress updates. Study Pack file warming happens in the background once a pack is opened online.
- The desktop Electron repo remains the reference line; this repo is the separate web conversion project.
