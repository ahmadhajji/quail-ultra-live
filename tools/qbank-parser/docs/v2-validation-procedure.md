# v2 Pipeline — Live Validation Procedure (PR 5)

This is the manual validation gate before promoting `--v2` to the default
behavior in PR 6. Run after the OpenAI account quota is restored.

## Prerequisites

1. OpenAI account has credits and the spend limit on the API key allows
   roughly **$0.50** for the test deck.
2. `OPENAI_API_KEY` is set in `tools/qbank-parser/.env`.
3. Python deps are installed: `pip install -e .` from `tools/qbank-parser/`.
4. The Google Slides deck is shared with the OAuth identity stored in
   `token.json` (or service-account credentials in `credentials.json`).

## Smoke run

```bash
cd tools/qbank-parser

python3 main.py --v2 \
  --google-slides-link "https://docs.google.com/presentation/d/177ejl2prsW-IsFKbrtdFSaSOg4V3ozXnzt2Q1zW3Ijo/edit" \
  --rotation Pediatrics \
  --pack-id v2-peds-test \
  --title "Peds v2 Validation" \
  --native-pack-dir output/v2-validation
```

The CLI prints a one-line summary at the end with: slides parsed,
questions detected, questions rewritten, AI calls, total tokens, cache
hits, duration, and the final native pack path.

## Expected outputs

After a clean run on a 16-slide deck:

- `output/v2-validation/raw_slides.json` — 16 entries, each with
  `text_blocks`, `speaker_notes`, `highlighted_texts`, `image_paths`,
  `slide_screenshot_path`, `comments`.
- `output/v2-validation/detected_questions.json` — roughly 14-18 entries
  (multi-question slides 13 and 16 each yield 2). Every entry has
  non-empty `stem_text`, 4-5 `choices`, a non-empty `correct_answer`.
- `output/v2-validation/rewritten_questions.json` — every entry has a
  non-empty `stem`, `correct_explanation`, `incorrect_explanations` for
  each non-correct choice, and a non-empty `educational_objective`.
- `output/v2-validation/v2_run_stats.json` — must show:
  - `detect_calls`: 16
  - `rewrite_calls`: ~14-18 (matches detected_questions count)
  - `prompt_tokens` + `completion_tokens` total < 80,000
- `output/v2-validation/packs/v2-peds-test/quail-ultra-pack.json` —
  validates against `shared/native-contracts/quail-ultra-qbank/v1/pack.schema.json`.
- `output/v2-validation/packs/v2-peds-test/questions/*.json` — one file
  per question, each validates against `question.schema.json`.

## Cost gate

Compute: `(prompt_tokens × $0.0000005) + (completion_tokens × $0.000002)`
with current `gpt-5.4-mini` + `gpt-5.4` pricing assumptions. Acceptance:

- Per-question cost ≤ **$0.03**
- Per-deck cost ≤ **$0.50**

If actual cost exceeds this, downgrade `STAGE3_MODEL` env override to
`gpt-5.4-mini` first; do NOT downgrade reasoning effort below `medium`.

## Quality gate (manual spot-check, 4 random questions)

For each of 4 randomly chosen questions:

1. Stem reads as a clean, USMLE-style vignette (paragraph form, ends with a
   single lead-in question).
2. All 4-5 choices are clinically plausible distractors (not obvious throwaways).
3. The correct answer matches the source slide's intent (open the slide
   screenshot at `source-slides/<media_id>` to verify).
4. Each non-correct choice has an explanation that explains WHY it is
   wrong, not just that it is wrong.
5. The educational objective is a single, testable, high-yield sentence.

If any question fails (1)-(5), open the corresponding `detected_questions.json`
entry to confirm whether the failure was upstream (Stage 2 missed something)
or downstream (Stage 3 hallucinated). Stage 2 misses → file as a Stage 2
prompt fix; Stage 3 hallucinations → file as a Stage 3 prompt fix.

## App-side smoke

1. Symlink or copy `output/v2-validation/packs/v2-peds-test/` into the
   app's native packs location.
2. Add the pack to the app's pack manifest.
3. Run the app dev server and open the block in `ExamViewPage`.
4. Confirm:
   - Questions render with stem, randomized choices, correct A/E IDs.
   - Submit a wrong answer in tutor mode → explanation reveals the
     `educational_objective` block plus per-choice incorrect explanations.
   - Click "Source Slide" button → opens the correct slide screenshot.
   - Yellow ⚠ warning badge in the footer appears only on questions
     whose Stage 2 flagged `needs_review`.

## What "passing" looks like

- Cost gate passes (per-question ≤ $0.03).
- Output gate passes (no missing educational objectives, no missing
  per-choice incorrect explanations).
- Spot-check gate passes (4/4 questions meet the quality bar above).
- App-side smoke passes (questions render, source slide button works,
  warning badge appears only where flagged).

If all four gates pass, proceed to PR 6 (deletion + `--v2` becomes default).

If any gate fails, open a focused fix branch (`codex/v2-fix-<name>`),
land the patch, and rerun this procedure end-to-end before continuing.
