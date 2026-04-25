# ADR-003: Provider Adapter Strategy

- Status: Accepted
- Date: 2026-03-05

## Context
Provider logic (request payloads, error handling, response extraction) was mixed into orchestration modules.

## Decision
Use provider adapters under `providers/` for extraction and formatter interactions.

## Consequences
- Positive: orchestration code is provider-agnostic.
- Positive: payload and error behavior can be tested in isolation.
- Tradeoff: adapter interfaces must be kept stable when provider APIs evolve.
