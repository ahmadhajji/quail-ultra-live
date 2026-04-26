# QBank Parser Local Tool

`tools/qbank-parser` is vendored into this repository so the Quail Ultra native
QBank contract and parser evolve together.

The parser is a local Python tool only. It is not part of the Railway runtime,
the Express server, the Vite frontend, or the production Docker image.

Primary native workflow:

```bash
python3 tools/qbank-parser/main.py \
  --google-slides-link "<slides-url>" \
  --rotation Pediatrics \
  --native-pack-dir tools/qbank-parser/output/packs/pediatrics \
  --pack-id pediatrics \
  --slide-range 1-15 \
  --max-slides 15 \
  --append-native
```

Useful root helpers:

```bash
npm run parser:help
npm run parser:test
```

Cost-safety defaults:

- Use `--slide-range` or `--max-slides` before real AI runs.
- Use `--dry-run-cost` to verify limits without AI calls.
- Native exports write `validation/native_sample_report.json` and
  `validation/native_sample_report.md`.
- Questions with warnings are included by default; true extraction errors and
  non-question slides are excluded and reported.

