from __future__ import annotations

import subprocess
from pathlib import Path

import pytest


@pytest.mark.integration
def test_docs_smoke_commands_script() -> None:
    repo_root = Path(__file__).resolve().parents[1]
    script = repo_root / "docs" / "scripts" / "smoke_commands.sh"

    result = subprocess.run(
        ["bash", str(script)],
        cwd=repo_root,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert "docs smoke commands passed" in result.stdout
