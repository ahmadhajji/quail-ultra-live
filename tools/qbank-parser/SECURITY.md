# Security Policy

## Supported Versions
Only the latest version on `main` is supported for security fixes.

## Reporting a Vulnerability
If you discover a security issue, do not open a public issue.

1. Create a private vulnerability report through GitHub Security Advisories (preferred).
2. Include reproduction steps, impact, and any proof of concept.
3. If relevant, include affected files and commit hashes.

You can expect an acknowledgment within 5 business days.

## Sensitive Data
This repository processes potentially sensitive source material. For safe use:
- Keep API keys in `.env` only.
- Never commit credentials (`credentials.json`, `token.json`) or generated payloads containing private content.
