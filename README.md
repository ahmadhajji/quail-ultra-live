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

Primary target is Railway Hobby for hosting, with SQLite on a mounted volume for relational data and metadata plus a Railway Bucket for Study Pack files.

Recommended production environment variables:

- `QUAIL_STORAGE_BACKEND=railway`
- `QUAIL_DATA_DIR=/data`
- `SESSION_SECRET`
- `ALLOW_REGISTRATION`
- either `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- or the Railway Bucket variables `AWS_ENDPOINT_URL`, `AWS_DEFAULT_REGION`, `AWS_S3_BUCKET_NAME`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`

Railway config lives in [railway.toml](/Users/ahmadhajji/.gemini/antigravity/scratch/quail-ultra-live/railway.toml).

Local development still defaults to the local filesystem + SQLite backend. To bootstrap an admin locally without the old runtime auto-seed, set:

```bash
export LOCAL_BOOTSTRAP_ADMIN_USERNAME=ahmad
export LOCAL_BOOTSTRAP_ADMIN_PASSWORD=secret
```

Railway setup and cutover notes live in [docs/railway-operations.md](/Users/ahmadhajji/.gemini/antigravity/scratch/quail-ultra-live/docs/railway-operations.md).
The earlier Vercel runbook remains in [docs/vercel-cutover.md](/Users/ahmadhajji/.gemini/antigravity/scratch/quail-ultra-live/docs/vercel-cutover.md) for rollback/reference only.

## Notes

- Auth now uses a signed HttpOnly cookie instead of the in-memory Express session store.
- Local mode stores packs on disk and relational data in SQLite under `data/`.
- Railway mode stores packs in an S3-compatible bucket and relational data in SQLite under `QUAIL_DATA_DIR`.
- Railway imports use direct browser-to-bucket uploads through presigned URLs, and zip exports are built in the browser from the authenticated manifest + file endpoints.
- The older Vercel cloud mode remains in the repo as a deprecated path while Railway becomes the default deployment target.
- Offline behavior is local-first for cached packs and queued progress updates. Study Pack file warming happens in the background once a pack is opened online.
- The desktop Electron repo remains the reference line; this repo is the separate web conversion project.
