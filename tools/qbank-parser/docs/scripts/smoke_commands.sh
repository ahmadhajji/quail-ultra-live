#!/usr/bin/env bash
set -euo pipefail

python3 main.py --help >/dev/null
python3 main.py --status >/dev/null

echo "docs smoke commands passed"
