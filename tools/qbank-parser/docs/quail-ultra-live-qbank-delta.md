# Quail Ultra Live QBank Delta Note

This note records qbank-format changes that appear needed or welcome for Quail Ultra Live, without changing the current `qbank-parser` exporter yet. It is a delta/backlog document, not the final standard.

Current baseline references:

- `qbank-parser` current Quail export behavior: `export/quail_export.py`
- Quail Ultra Live current accepted format: `/Users/ahmadhajji/.gemini/antigravity/scratch/quail-ultra-live/docs/qbank-format.md`

## Current Baseline

| Area | `qbank-parser` output today | Quail Ultra Live accepts today | Proposed Ultra Live extension |
| --- | --- | --- | --- |
| Core folder | Writes `*-q.html`, `*-s.html`, `choices.json`, `index.json`, `tagnames.json`, `groups.json`, `panes.json`, plus pane HTML files | Expects same legacy Quail layout and can backfill some metadata | Keep legacy files unchanged |
| Choice metadata | `choices.json` stores option letters and correct letter only | Can use `choices.json`, otherwise may infer from HTML | Add `question-meta.json.choice_text_by_letter` so player/importer does not recover labels from HTML |
| Tags | `index.json` + `tagnames.json` with `Rotation` and `Topic` | Same | No required change for this note |
| Grouping | `groups.json` currently empty from exporter | Same | Keep `groups.json`; use sidecar metadata for same-slide sibling relationships first |
| Images | Question/explanation images copied beside HTML files | Same | Add source slide image assets under `source-slides/` |
| Source traceability | Original `question_id` only appears in source JSON before export | No explicit source-slide contract | Add per-question source metadata in `question-meta.json` |
| Fact-check / disagreement | No export field for disputed answers or slide confidence category | No current UI contract | Add slide consensus and fact-check metadata |
| Randomization control | Correct answer letter survives, but no explicit display-order contract | App can render from HTML and metadata | Add explicit choice presentation metadata for safe shuffling |

### Legacy Files To Keep Unchanged

- `index.json`
- `tagnames.json`
- `choices.json`
- `groups.json`
- `panes.json`
- `*-q.html`
- `*-s.html`

### Proposed New Sidecar File

- `question-meta.json`
- Shape: top-level object keyed by qid
- Scope: Ultra Live extension only
- Goal: carry source provenance, validation signals, and rendering controls without breaking legacy Quail compatibility

### Proposed Local Asset Convention

- Source slide images should live under `source-slides/`
- Shared asset path format should be:
  - `source-slides/<deck_id>__slide_<slide_number>.png`
- These assets are additive and should not replace question or explanation assets already used by legacy HTML

## Reported Problems Mapped To Format Gaps

| Reported issue | Current gap | Proposed metadata / rule |
| --- | --- | --- |
| Too many answers end up as `A` or `B` | No explicit display-order metadata and no audit hook after export | Add `choice_presentation.shuffle_allowed`, `choice_presentation.display_order[]`, and recommend bank-level answer-letter audit |
| White / blue / yellow slide meaning matters | No exported representation of consensus state | Add `slide_consensus.status` |
| Need expandable source slide in player | No stable source-slide asset contract | Add `source_slide.asset_path` and `source_slide.expandable` |
| BAT markers like `bat25`, `bat26`, `bat2*` leak into choices | No format-level ignore rule for import/validation | Add explicit ignore regex `/^bat\\d+[a-z*]*$/i` to importer/validator rules |
| Repeated same-slide questions can disagree on answer | No same-slide linkage or conflict-detection key | Add `source_group_id`, `related_qids[]`, `dedupe_fingerprint`, and validator rule for conflicting siblings |
| AI may think slide answer is inaccurate | No solver-facing place to show fact-check dispute | Add `fact_check.*` metadata and UI note/badge guidance |
| Need room for Ultra Live-only behavior beyond legacy Quail | Legacy layout has limited structured fields | Add one Ultra Live sidecar instead of mutating legacy files |

## Required Ultra Live Extensions

### `question-meta.json` field contract

Each proposed field below is marked as `required later`, `recommended`, or `optional`.

| Field | Status | Type | Notes |
| --- | --- | --- | --- |
| `source.deck_id` | required later | string | Stable deck/source identifier |
| `source.slide_number` | required later | integer | Original slide number |
| `source.question_index` | required later | integer | Original within-slide question index |
| `source.question_id` | recommended | string | Original parser question id before Quail renumbering |
| `source_group_id` | required later | string | Exact format: `<deck_id>:<slide_number>` |
| `source_slide.asset_path` | required later | string | Local path to source slide image, usually under `source-slides/` |
| `source_slide.expandable` | required later | boolean | If `true`, Ultra Live should allow source slide expansion from solve/review view |
| `slide_consensus.status` | required later | string enum | `clear`, `consensus`, `no_consensus` |
| `fact_check.status` | recommended | string enum | `confirmed`, `disputed`, `unresolved` |
| `fact_check.note` | recommended | string | Human-readable note for UI footnote/badge |
| `fact_check.sources[]` | recommended | string[] | Supporting URLs, citations, or source labels |
| `fact_check.model` | optional | string | Fact-checking model identifier such as `gpt-5.4` |
| `choice_text_by_letter` | required later | object | Maps choice letter to rendered choice text; explicit metadata should beat HTML inference |
| `choice_presentation.shuffle_allowed` | required later | boolean | Safe randomization toggle |
| `choice_presentation.display_order[]` | recommended | string[] | Explicit authored/displayed order of answer letters |
| `warnings[]` | recommended | string[] | Import, extraction, or review warnings visible to admins and optionally learners |
| `related_qids[]` | recommended | string[] | Same-slide or near-duplicate siblings |
| `dedupe_fingerprint` | recommended | string | Stable normalized hash/string for near-duplicate detection |

### Semantics For Proposed Enums

#### `slide_consensus.status`

- `clear`
  - White slide
  - Straightforward question/answer
  - No meaningful disagreement noted
- `consensus`
  - Blue slide
  - Harder or less obvious answer
  - Consensus exists due to doctor confirmation, cited source, or repeated agreement
- `no_consensus`
  - Yellow slide
  - No reliable consensus as of authoring time
  - Should surface caution in Ultra Live

#### `fact_check.status`

- `confirmed`
  - Exported answer aligns with fact-check result
- `disputed`
  - Slide was extracted as-is, but downstream fact-check believes answer or content is inaccurate
- `unresolved`
  - Automated review could not confidently confirm or dispute

## Recommended Validator / Import Rules

### Metadata precedence

- Explicit metadata should win over HTML inference.
- If both `choices.json` and `question-meta.json.choice_text_by_letter` exist, Ultra Live should use explicit metadata and should not infer answer labels from stem HTML.
- HTML extraction should remain compatibility fallback only.

### Choice and marker hygiene

- Ignore BAT repetition markers matching `/^bat\\d+[a-z*]*$/i` during extraction, import, validation, and UI choice parsing.
- Treat such markers as slide keys/annotations, not answer candidates.
- Warn if a choice label appears in HTML but not in `choices.json` or `choice_text_by_letter`.

### Same-slide conflict protection

- Questions sharing the same `source_group_id` and a near-identical normalized stem should be compared before silent import.
- If those siblings have different correct answers and there is no clear differentiating keyword captured in metadata, mark them as conflict candidates.
- Conflict candidates should be blocked from silent import and marked for human review.
- `related_qids[]` should connect same-slide siblings even when import proceeds.

### Randomization safeguards

- Treat answer distribution skew as both pipeline problem and player problem.
- Format should support shuffling without losing authored correct mapping.
- If `choice_presentation.shuffle_allowed` is `false`, preserve authored `display_order[]`.
- If shuffling is enabled, correctness must follow the letter-to-text mapping after shuffle, not the original position.
- Recommend a periodic bank-level answer-letter audit after export to catch suspicious clustering such as excessive `A` / `B` correct answers.

### Source-slide access

- If `source_slide.expandable` is `true`, Ultra Live should expose a source-slide button or equivalent affordance from question and review screens.
- If the asset is missing, importer should warn and disable expansion rather than fail qbank load.

### Fact-check visibility

- `fact_check.status = disputed` or `unresolved` should produce a visible badge, footnote, or caution strip in solve and review flows.
- `fact_check.note` should explain whether the original slide was preserved verbatim and why the item is flagged.
- `fact_check.sources[]` should be accessible from the same note when available.

## Welcome Future Extensions

These are welcome additions, but not required by this note:

- import-time provenance timestamps such as `source.imported_at`
- reviewer metadata such as `review.last_human_review_at`
- richer disagreement structure such as `fact_check.alternatives[]`
- deck-level analytics file for answer-distribution audits
- explicit `ui_badges[]` if Ultra Live later wants presentation-level metadata separate from source metadata

## Worked JSON Example

Folder example:

```text
sample-qbank/
  101-q.html
  101-s.html
  choices.json
  groups.json
  index.json
  panes.json
  question-meta.json
  source-slides/
    cardio_deck__slide_12.png
  tagnames.json
```

Example `question-meta.json`:

```json
{
  "101": {
    "source": {
      "deck_id": "cardio_deck",
      "slide_number": 12,
      "question_index": 2,
      "question_id": "12.2"
    },
    "source_group_id": "cardio_deck:12",
    "source_slide": {
      "asset_path": "source-slides/cardio_deck__slide_12.png",
      "expandable": true
    },
    "slide_consensus": {
      "status": "consensus"
    },
    "fact_check": {
      "status": "disputed",
      "note": "Question preserved from slide, but downstream fact-check found the keyed answer likely outdated.",
      "sources": [
        "https://example.org/guideline-update"
      ],
      "model": "gpt-5.4"
    },
    "choice_text_by_letter": {
      "A": "Stable angina",
      "B": "NSTEMI",
      "C": "GERD",
      "D": "Acute pericarditis"
    },
    "choice_presentation": {
      "shuffle_allowed": true,
      "display_order": ["A", "B", "C", "D"]
    },
    "warnings": [
      "Same-slide sibling exists; review if this stem was split correctly."
    ],
    "related_qids": ["102"],
    "dedupe_fingerprint": "cardio_deck:12:normalized-stem-7e3c0b"
  }
}
```

## Migration Notes

- This note proposes additive metadata only.
- Legacy Quail files remain source of compatibility for old banks and old loaders.
- Ultra Live can treat `question-meta.json` as optional at first, then gradually ratchet validation once parser/export support lands.
- Import path should continue accepting legacy banks that only contain the current layout described in Ultra Live's existing `docs/qbank-format.md`.
- `qbank-parser` does not need to emit `question-meta.json` yet for this note to be useful.

## Deferred Parser/Prompt Hardening Items

These belong to later implementation work in `qbank-parser`, not this doc-only change:

- capture slide background color/category during parse or review so `slide_consensus.status` can be emitted reliably
- preserve per-question source slide image references into export artifacts
- harden extraction prompts so same-slide variants keep the distinguishing keyword that changes the answer
- add conflict detection before export for same-slide near-duplicates with different correct answers
- strip BAT repetition markers before choice assembly and before formatter prompts
- strengthen fact-check prompts and structured output so disputed content can be surfaced cleanly
- add answer-distribution audit tooling after export

## Notes For Later Implementation

- Prefer one additive sidecar file over mutating `choices.json` or embedding large JSON blobs inside HTML.
- Keep source metadata machine-readable first; UI rendering decisions can evolve in Ultra Live after standards settle.
- After Ultra Live standards are finalized, come back to `qbank-parser` and implement exporter changes against the final agreed contract.
