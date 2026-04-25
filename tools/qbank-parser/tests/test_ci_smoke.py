from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest


@pytest.mark.integration
def test_cli_help_smoke() -> None:
    repo_root = Path(__file__).resolve().parents[1]
    result = subprocess.run(
        [sys.executable, "main.py", "--help"],
        cwd=repo_root,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0
    assert "QBank Parser" in result.stdout
    assert "--format-usmle" in result.stdout
    assert "--repair-quail-dir" in result.stdout
    assert "--gui" not in result.stdout
