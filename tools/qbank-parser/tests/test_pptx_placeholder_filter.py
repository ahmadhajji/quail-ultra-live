from __future__ import annotations

from pathlib import Path

from PIL import Image

from parsers.pptx_parser import _is_placeholder_image


def test_is_placeholder_image_detects_white(tmp_path):
    path = tmp_path / "white.png"
    Image.new("RGB", (300, 300), color=(255, 255, 255)).save(path)
    assert _is_placeholder_image(path) is True


def test_is_placeholder_image_keeps_non_placeholder(tmp_path):
    path = tmp_path / "noise.png"
    Image.effect_noise((500, 500), 100).convert("RGB").save(path)
    assert _is_placeholder_image(path) is False

