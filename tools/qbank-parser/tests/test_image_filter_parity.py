from __future__ import annotations

from pathlib import Path

from PIL import Image

from export.quail_export import is_white_image
from parsers.pptx_parser import _is_placeholder_image
from utils.image_filters import is_placeholder_image_for_export, is_placeholder_image_for_extraction


def _write_solid(path: Path, color: tuple[int, int, int], size: tuple[int, int]) -> None:
    Image.new("RGB", size, color=color).save(path)


def _write_noise(path: Path, size: tuple[int, int]) -> None:
    Image.effect_noise(size, 100).convert("RGB").save(path)


def test_parser_wrapper_matches_extraction_helper(tmp_path):
    white = tmp_path / "white.png"
    noise = tmp_path / "noise.png"
    _write_solid(white, (255, 255, 255), (300, 300))
    _write_noise(noise, (500, 500))

    assert _is_placeholder_image(white) == is_placeholder_image_for_extraction(white)
    assert _is_placeholder_image(noise) == is_placeholder_image_for_extraction(noise)


def test_quail_wrapper_matches_export_helper(tmp_path):
    white = tmp_path / "white.png"
    noise = tmp_path / "noise.png"
    _write_solid(white, (255, 255, 255), (300, 300))
    _write_noise(noise, (500, 500))

    assert is_white_image(white) == is_placeholder_image_for_export(white)
    assert is_white_image(noise) == is_placeholder_image_for_export(noise)
