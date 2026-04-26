# Pipeline Runbook

## Purpose
Operational guide for running, resuming, and recovering pipeline executions.

## Standard Run
1. Extract questions: `python main.py <file.pptx>`
2. Optional review: `python main.py --review`
3. Format to USMLE: `python main.py --format-usmle --formatter-provider openai`
4. Export Quail: `python main.py --export-quail`

## Resume and Recovery
- Extraction resume state: `output/extraction_progress.json`
- Formatter cache state: `output/usmle_formatter_cache.json`
- Formatter progress state: `output/usmle_formatter_progress.json`

If a run is interrupted:
1. Re-run the same command.
2. Confirm progress files still exist.
3. Inspect latest output JSON for partial stage completion.

## Partial Output Handling
- Extraction partials are expected when interrupted.
- Formatter cache entries are keyed by stable question ID and input hash.
- Corrupted/partial files should be replaced from backups before re-run.

## Rollback Playbook
1. Stop current run.
2. Restore previous artifacts from `output/formatter_backups/<timestamp>/`.
3. Re-run formatter with the same provider/model settings.
4. Validate question count and IDs against expected source.

## Common Failures
- Missing `OPENAI_API_KEY`: configure `.env` and retry.
- Duplicate `question_id` values: resolve before formatting.
- Provider throttling (`429`): retry; scheduler performs adaptive backpressure.
