# Vercel Cutover Runbook

## Production Target

- Hosting: Vercel
- Relational data: Neon Postgres via `DATABASE_URL`
- Study Pack storage: private Vercel Blob via `BLOB_READ_WRITE_TOKEN`
- Public hostname: `quail.clinicalvault.me`
- DNS owner: Cloudflare

## Required Setup

1. Create or connect a Neon Postgres database and set `DATABASE_URL` in Vercel.
2. Create a private Blob store in the Vercel project and set `BLOB_READ_WRITE_TOKEN`.
3. Set `SESSION_SECRET`.
4. Keep `ALLOW_REGISTRATION` aligned with the desired registration mode.
5. Confirm the Vercel project uses Node `24.x`.

## Local Snapshot Migration

Use the one-off migration script after pulling a final snapshot of the old server data locally:

```bash
npm run migrate:cloud -- --snapshot /path/to/data-snapshot
```

Optional explicit paths:

```bash
npm run migrate:cloud -- --db /path/to/quail-ultra-live.db --packs /path/to/study-packs
```

The migration script:

- copies `users`, `invites`, and `app_settings` into Neon
- uploads each Study Pack workspace into Blob under `packs/<packId>/workspace`
- rewrites `study_packs.workspace_path` to the Blob prefix
- prints local vs remote row counts at the end

## Recommended Cutover

1. Stop writes on the homelab app.
2. Back up `/home/ahmad/apps/quail-ultra-live/data` outside the repo/worktree.
3. Pull the snapshot locally from `10.5.5.10`.
4. Run `npm run migrate:cloud`.
5. Deploy the current branch or merged `main` to Vercel.
6. Smoke-test the Vercel URL:
   - `GET /api/health`
   - login
   - open an existing pack
   - save progress
   - export zip
7. Add `quail.clinicalvault.me` to the Vercel project.
8. Update the Cloudflare DNS record to point at Vercel instead of the old tunnel target.
9. Re-test `https://quail.clinicalvault.me/api/health`.
10. Retire the old tunnel and Docker deployment path after validation.

## Rollback

If cutover fails:

1. Point Cloudflare DNS back to the previous origin/tunnel.
2. Restart the old homelab deployment from the preserved snapshot.
3. Keep the Vercel deployment isolated until the issue is fixed.
