# Railway Operations Runbook

## Production Target

- Hosting: Railway Hobby
- App runtime: single Node service
- Relational data: SQLite at `QUAIL_DATA_DIR/quail-ultra-live.db`
- Study Pack storage: Railway Bucket via the S3-compatible API
- Public hostname: `quail.clinicalvault.me`
- DNS owner: Cloudflare

## Required Environment

- `QUAIL_STORAGE_BACKEND=railway`
- `QUAIL_DATA_DIR=/data`
- `SESSION_SECRET`
- `ALLOW_REGISTRATION`
- either `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- or Railway Bucket's injected `AWS_ENDPOINT_URL`, `AWS_DEFAULT_REGION`, `AWS_S3_BUCKET_NAME`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`

## Railway Service Setup

1. Create one Railway service from this repo.
2. Mount one Railway Volume at `/data`.
3. Create one Railway Bucket and wire its S3 credentials into the service variables.
4. Set a custom build command to `npm run build`.
5. Set the start command to `npm run start:railway`.
6. Set the healthcheck path to `/api/health`.
7. Enable serverless sleep for production.
8. Set project cost controls with a hard usage limit of `$10`.

## Staging

- Use a second Railway environment only when needed.
- Copy production variables into staging.
- Mount a separate staging volume and bucket.
- Shut staging down after validation to avoid recurring cost.

## Snapshot Migration

Use the Railway migration script after pulling a final snapshot of the old server data locally:

```bash
QUAIL_STORAGE_BACKEND=railway \
QUAIL_DATA_DIR=/path/to/target-data \
S3_ENDPOINT=... \
S3_REGION=... \
S3_BUCKET=... \
S3_ACCESS_KEY_ID=... \
S3_SECRET_ACCESS_KEY=... \
npm run migrate:railway -- --snapshot /path/to/data-snapshot
```

You can substitute the equivalent Railway Bucket `AWS_*` variables if you are running the migration inside a Railway service shell.

Optional explicit paths:

```bash
npm run migrate:railway -- --db /path/to/quail-ultra-live.db --packs /path/to/study-packs
```

The migration script:

- creates or reuses the target SQLite schema
- upserts users, invites, settings, and pack metadata
- uploads each Study Pack workspace into the Railway Bucket under `packs/<packId>/workspace`
- stores each pack row with `workspace_path` set to that bucket prefix
- resumes safely by skipping already uploaded objects

## Recommended Cutover

1. Stop writes on the homelab app.
2. Back up `/home/ahmad/apps/quail-ultra-live/data` outside the repo/worktree.
3. Pull the snapshot locally from `10.5.5.10`.
4. Deploy Railway staging.
5. Run `npm run migrate:railway` against staging volume + bucket.
6. Smoke-test staging:
   - `GET /api/health`
   - login
   - open an existing pack
   - save progress
   - import a Study Pack
   - export zip
7. Deploy Railway production.
8. Run the final migration against production volume + bucket.
9. Smoke-test the Railway production URL.
10. Update Cloudflare DNS for `quail.clinicalvault.me` to point to Railway.
11. Re-test `https://quail.clinicalvault.me/api/health`.
12. Keep the old homelab deployment as rollback briefly, then retire it.

## Rollback

If cutover fails:

1. Point Cloudflare DNS back to the previous origin.
2. Restart the old homelab deployment from the preserved snapshot.
3. Keep Railway isolated until the issue is fixed.
