# ADR-001: Domain Model Extraction

- Status: Accepted
- Date: 2026-03-05

## Context
Core dataclasses were previously defined inside provider modules, creating ownership confusion and cross-module coupling.

## Decision
Canonical shared dataclasses are defined in `domain/models.py` and imported by extraction, review, formatting, and export code.

## Consequences
- Positive: consistent model ownership and simpler dependency graph.
- Positive: easier test setup and cross-stage contract validation.
- Tradeoff: temporary compatibility imports may remain during migration.
