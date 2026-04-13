# QBank Format For Quail Ultra Live

This document describes the qbank folder shape Quail Ultra Live actually expects today. It is intentionally strict enough to help the parser/application avoid runtime errors, while still noting the legacy metadata the app can auto-generate.

## Folder Layout

Each qbank should live in one folder containing:

- `index.json`
- `tagnames.json`
- `choices.json`
- `groups.json`
- `panes.json`
- optional `progress.json`
- one `*-q.html` file per question
- one `*-s.html` file per question
- any local assets referenced by the HTML files, such as images, audio, video, or supporting pane files

The question id is the filename stem. For question `101`, the required files are:

- `101-q.html`
- `101-s.html`

Quail Ultra Live can auto-generate missing `index.json`, `tagnames.json`, `choices.json`, `groups.json`, and `panes.json` for legacy banks, but that should be treated as compatibility fallback rather than the preferred authoring path.

## Required Pairing Rules

- Every `*-q.html` must have a matching `*-s.html`.
- Every qid listed in `index.json` should have both files.
- `choices.json` and `groups.json` must only reference existing qids.
- `panes.json` should only reference files that actually exist in the folder.

## Metadata Files

### `index.json`

Maps qids to tag columns.

Example:

```json
{
  "101": { "0": "Cardiology", "1": "Electrophysiology" },
  "102": { "0": "Cardiology", "1": "Ischemia" }
}
```

Rules:

- Keys are qids.
- Values are objects keyed by tag column index as strings: `"0"`, `"1"`, and so on.
- Every qid used by the bank should appear here.
- Tag column count should match `tagnames.json`.

### `tagnames.json`

Defines the labels for each tag column.

Example:

```json
{
  "tagnames": {
    "0": "System",
    "1": "Topic"
  }
}
```

Rules:

- Keep indices aligned with `index.json`.
- The primary bucket logic uses column `0`, so this tag should be stable and meaningful.

### `choices.json`

Defines answer options and the correct answer.

Example:

```json
{
  "101": {
    "options": ["A", "B", "C", "D"],
    "correct": "B"
  }
}
```

Rules:

- `options` should match the answer letters used in the question stem.
- `correct` should be one of those option letters.
- If the file is missing, the app may try to infer it from the HTML, but explicit metadata is safer.

### `groups.json`

Defines grouped-question sequencing.

Example:

```json
{
  "101": { "next": "102" },
  "102": { "prev": "101" }
}
```

Rules:

- `prev` and `next` must point to existing qids.
- Avoid circular chains unless that behavior is intentional and tested.
- Keep group links symmetric when applicable.

### `panes.json`

Defines external reference panes or pop-out files.

Example:

```json
{
  "Lab Values": {
    "file": "lab-values.html",
    "prefs": "width=900,height=700"
  }
}
```

Rules:

- `file` must exist inside the qbank folder.
- `prefs` is passed through to `window.open`.

### `progress.json`

Optional. If missing, the app initializes it. It should be treated as runtime state, not authoring content.

## HTML Rules

### Question HTML: `*-q.html`

The exam screen loads this file as the stem and tries to strip duplicated answer blocks out of the displayed stem before rendering the separate answer area.

Authoring rules:

- Keep answer choices in a consistent `A)`, `B)`, `C)` or `A.`, `B.`, `C.` pattern.
- Avoid repeating the same answer letters multiple times in unrelated parts of the stem.
- Keep referenced local assets relative to the qbank folder.
- Do not rely on remote assets when local assets are available.

### Solution HTML: `*-s.html`

The explanation panel loads this file directly.

Authoring rules:

- Keep the correct answer clearly stated.
- Keep local asset paths relative and valid.

## Common Failure Modes

- Missing paired question/solution files.
- `index.json` contains qids that do not exist on disk.
- `groups.json` points to nonexistent qids.
- Choice markup in the stem is ambiguous, duplicated, or not lettered consistently.
- Pane definitions point to missing HTML files.
- HTML references assets that are not present in the folder.
- Tag column counts in `index.json` and `tagnames.json` drift out of sync.

## Validator

Run:

```bash
npm run validate:qbank -- /path/to/qbank
```

What it checks:

- missing `*-q.html` / `*-s.html` pairs
- broken qid references in metadata
- pane targets that do not exist
- missing local assets referenced from HTML
- group chains that are broken or circular
- ambiguous answer-letter extraction patterns

The validator exits non-zero on errors and prints warnings for risky but still loadable content.
