# ADR-002: Run Repository Boundary

- Status: Accepted
- Date: 2026-03-05

## Context
Pipeline stages used direct ad-hoc file reads/writes and implicit filesystem contracts.

## Decision
Introduce `storage/run_repository.py` as the persistence boundary for atomic JSON writes and artifact loading.

## Consequences
- Positive: fewer duplicated IO patterns and safer checkpoint writes.
- Positive: easier unit tests by mocking repository behavior.
- Tradeoff: staged migration needed until all direct file access paths are removed.
