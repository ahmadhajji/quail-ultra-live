from __future__ import annotations

import pytest

import main


def test_infer_rotation_from_title_matches_expected():
    assert main.infer_rotation_from_title("Internal Medicine 1 - Batch A") == "Internal Medicine"
    assert main.infer_rotation_from_title("General Surgery revision") == "General Surgery"
    assert main.infer_rotation_from_title("Obstetrics & Gynecology set") == "OB-GYN"
    assert main.infer_rotation_from_title("Pediatrics Mock") == "Pediatrics"


def test_infer_rotation_from_title_fails_when_unknown():
    with pytest.raises(ValueError):
        main.infer_rotation_from_title("Random deck title with no rotation")

