# QBank Parser Vendored Tool

This directory is a local Python tool vendored into Quail Ultra Live.

- It is not part of the Railway deployment, Express server, or frontend build.
- Do not commit local `.env`, Google OAuth tokens, credentials, generated output,
  parser archives, or Python build artifacts.
- The primary output target is Quail Ultra native QBank format.
- Legacy Quail export is a compatibility command only.
- Prefer tests under this directory for parser changes, plus Quail Ultra native
  contract/import tests when output shape changes.

