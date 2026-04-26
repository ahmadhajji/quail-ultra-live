# ADR-004: CI Quality Gates Policy

- Status: Accepted
- Date: 2026-03-05

## Context
Regression risk was high without enforceable lint/type/test checks in CI.

## Decision
Add CI checks for `ruff`, `mypy`, and `pytest` with an incremental rollout policy.

## Consequences
- Positive: baseline guardrails on every PR.
- Positive: consistent local/CI validation commands.
- Tradeoff: lint/type checks are initially non-blocking to avoid disruption during migration; they should be ratcheted to blocking after sustained green runs.
