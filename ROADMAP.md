# Product Roadmap And Change Tracker

This file is the standing workboard for `quail-ultra-live`.

Use it for both:

- a high-signal record of the important product and workflow changes that already landed
- the queue of what should be worked on next

This is not meant to replace the release-oriented [CHANGELOG](CHANGELOG.md). The changelog records shipped releases. This file tracks the ongoing product rework.

## Current Product Focus

The current emphasis is UI-first.

- Primary focus:
  Make the solving UI feel better, look better, and become easier to extend and edit.
- Secondary focus:
  Preserve the current backend and only tighten the places where qbank compatibility and standardization still need work.

Important guardrails:

- Keep qbank compatibility intact.
- Do not turn the roadmap into a backend rewrite.
- Use [docs/qbank-format.md](docs/qbank-format.md) as the base document for qbank standardization work.
- Keep the solving flow desktop-first and UWorld-inspired without copying proprietary branding or assets.

## How To Use This File

When starting work:

1. Pick one item from `Pending Next Up`.
2. Move it to `Active Now`.
3. Implement it on a feature branch.
4. Run `npm run check`.
5. Run `npm run test:smoke:local`.
6. Open a PR and merge it into `main` after approval and green CI.
7. Move the item to `Done / Landed`.
8. Promote the next best item from `Planned Backlog` into `Pending Next Up`.

Status meaning:

- `Done / Landed`
  Merged into `main` and no longer the current focus.
- `Active Now`
  Currently being implemented on a working branch.
- `Pending Next Up`
  Ready to pick up next. Clear enough to start without more product discovery.
- `Planned Backlog`
  Good future work, but not the immediate next item.
- `Parked / Later`
  Intentionally deferred. Keep the idea, but do not treat it as near-term work.

## Done / Landed

- Web fork structure in place with Express server, browser client, SQLite persistence, and Study Pack import/export flow.
- Tutor, Timed, and Untimed block modes added to the builder and solving flow.
- Exam screen reworked into a more UWorld-like continuous solving layout with a left rail and same-page review flow.
- Tutor-mode reveal behavior implemented so explanations appear immediately after submission on the same page.
- Timed and Untimed block review flow implemented so explanations stay hidden until block finish.
- Previous Blocks and Overview updated to understand mode, paused/completed state, and newer aggregate stats.
- Legacy `progress.json` compatibility preserved through normalization helpers and safer block key generation.
- Folder upload batching and async import finalization added for larger real-world Study Pack uploads.
- Cloudflare Tunnel upload reliability fixed by requiring `disableChunkedEncoding: true`.

## Active Now

- None. Move one item here before starting implementation.

## Pending Next Up

- Build a more flexible exam UI shell that is easier to manage and edit over time.
  Why: the current main priority is UI iteration speed, not backend expansion.
  Done when: the exam layout is organized into clearer reusable regions and future UI edits do not require brittle one-off changes across the page.
  Notes: this is a structure and maintainability pass, not a framework rewrite.

- Upgrade the question stem highlighting experience.
  Why: highlighting is a core study behavior and needs to feel first-class in the solving UI.
  Done when: the question stem supports a stronger highlight workflow with persistent, reliable interaction and a cleaner UX than the current baseline.
  Notes: library choice is still open; user is researching a React-friendly highlighting library and will provide that direction later.

- Rework the utility side-panel and top-right tool access for panes such as lab values and calculator.
  Why: reference tools need to feel integrated into the solving experience instead of bolted on.
  Done when: pane launches and utility access feel fast, predictable, and visually consistent with the rest of the exam shell.
  Notes: preserve existing pane support and compatibility with qbank-defined panes.

- Improve answer-to-explanation flow on the same page.
  Why: the main solving loop should feel smooth when selecting an answer, submitting, and reviewing the explanation below.
  Done when: the answer area, submission state, and explanation reveal/read flow feel intentional and easy to scan in Tutor and review modes.
  Notes: preserve mode-specific Tutor vs Timed/Untimed behavior.

- Add stronger multi-location navigation around the current question.
  Why: users should be able to move through a block from the top, beneath the question, and from the left rail without friction.
  Done when: navigation controls exist in the top area, under the question, and in the left rail with consistent behavior.
  Notes: avoid conflicting controls or duplicated logic across modes.

- Upgrade left-rail question status indicators.
  Why: the rail should communicate unopened, opened, current, correct, incorrect, and flagged state at a glance.
  Done when: unopened future questions can be visually distinct, solved questions show clear success/failure markers, and the current question is unmistakable.
  Notes: include treatment for unvisited future questions, green check / red X review states, and any needed flagged/current styling.

## Planned Backlog

- Tighten exam spacing, typography, and density so the interface feels more like a serious desktop study tool and less like a generic web app.
- Refine option-row styling so hover, selected, eliminated, locked, and submitted states are all immediately legible.
- Improve toolbar affordances across Tutor, Timed, Untimed, paused, and review states.
- Harden answer stripping for unusual qbank question markup so duplicate answer text does not leak into the stem on edge-case banks.
- Do a deeper manual pass on real question banks to catch resume, timing, grouped-question, pane, and explanation-rendering regressions.
- Expand automated smoke coverage around Tutor freeze/resume timing, Timed expiry, review-mode continuity, and question-status rendering.
- Standardize qbank compatibility rules and authoring expectations using [docs/qbank-format.md](docs/qbank-format.md) as the source of truth.
- Add deeper import validation and clearer failure reporting for malformed or partial Study Packs.
- Add a documented manual QA checklist for large real-world banks before release-facing UI changes are considered done.

## Parked / Later

- Notebook integration.
- Flashcards.
- Searchable explanation archive.
- Peer comparison analytics.
- Mobile-specific layout work.

## UI Vision Notes

These are recurring UI goals that should guide future work:

- The UI should be flexible and easy to edit without fragile page-wide changes.
- The exam screen should feel like one coherent study workspace, not a collection of disconnected widgets.
- Highlighting should feel native to the solving flow.
- Utility panes should feel integrated and fast.
- Navigation should be available from multiple sensible places, especially top, under-question, and left-rail locations.
- Question status should be readable at a glance, including unopened future questions and solved review states.
- Explanation reading should feel natural after answering, especially in the same-page Tutor flow.

## Backend Follow-Up Notes

Backend work is not the main focus right now, but these remain important:

- Keep qbank compatibility stable while tightening standardization rules.
- Use [docs/qbank-format.md](docs/qbank-format.md) as the baseline for any validator or import-rule changes.
- Prefer compatibility improvements, validation, and clearer failure handling over broad backend redesign.

## Item Template

Copy this block when adding a new item:

```md
- Short task title.
  Why: one sentence about the user-facing problem or goal.
  Done when: one sentence describing the acceptance bar.
  Notes: optional implementation or compatibility constraints.
```

## Session Notes

Add short dated notes here when useful. Keep them concise and factual.

- `2026-04-14`: Created this standing tracker so repo work can move item-by-item from pending to active to done instead of relying on ad hoc notes.
- `2026-04-14`: Reprioritized the roadmap around UI-first work: flexible exam layout, stronger highlighting, better pane/tool access, clearer navigation, and richer question-status signals. Kept backend follow-up limited to qbank compatibility and standardization.
