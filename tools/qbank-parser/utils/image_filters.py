"""Shared image placeholder filtering utilities."""

from __future__ import annotations

from pathlib import Path

from PIL import Image

# Placeholder/empty image filtering thresholds
MIN_IMAGE_SIZE_BYTES = 2048
WHITE_PIXEL_THRESHOLD = 0.95
FRAME_PLACEHOLDER_MIN_BYTES = 15000
FRAME_PLACEHOLDER_MAX_BYTES = 20000
FRAME_PLACEHOLDER_SIZE = 17276


def is_placeholder_image(image_path: str | Path, *, detect_mostly_white: bool = False) -> bool:
    """
    Return True if an image appears to be a white/empty placeholder.

    `detect_mostly_white=False` preserves extraction-stage behavior.
    `detect_mostly_white=True` preserves export-stage behavior.
    """
    image_path = Path(image_path)
    file_size = image_path.stat().st_size
    if file_size < MIN_IMAGE_SIZE_BYTES:
        return True

    try:
        with Image.open(image_path) as img:
            if img.mode != "RGB":
                img = img.convert("RGB")

            width, height = img.size
            if width < 50 or height < 50:
                return True

            if file_size == FRAME_PLACEHOLDER_SIZE or (
                FRAME_PLACEHOLDER_MIN_BYTES < file_size < FRAME_PLACEHOLDER_MAX_BYTES
            ):
                left = width // 4
                top = height // 4
                right = 3 * width // 4
                bottom = 3 * height // 4
                center_crop = img.crop((left, top, right, bottom))
                center_raw = center_crop.tobytes()
                center_total = len(center_raw) // 3

                if center_total > 0:
                    black_center = 0
                    white_center = 0
                    for idx in range(0, len(center_raw), 3):
                        r = center_raw[idx]
                        g = center_raw[idx + 1]
                        b = center_raw[idx + 2]
                        if r < 15 and g < 15 and b < 15:
                            black_center += 1
                        if r > 240 and g > 240 and b > 240:
                            white_center += 1

                    if (black_center / center_total) > 0.98 or (white_center / center_total) > 0.98:
                        return True

            if not detect_mostly_white:
                # Extraction stage deliberately keeps sparse white-background screenshots.
                return False

            raw = img.tobytes()
            total_pixels = len(raw) // 3
            if total_pixels == 0:
                return True

            white_count = 0
            for idx in range(0, len(raw), 3):
                if raw[idx] > 240 and raw[idx + 1] > 240 and raw[idx + 2] > 240:
                    white_count += 1
            return (white_count / total_pixels) > WHITE_PIXEL_THRESHOLD
    except Exception:
        return True


def is_placeholder_image_for_extraction(image_path: str | Path) -> bool:
    """Compatibility mode for parser extraction."""
    return is_placeholder_image(image_path, detect_mostly_white=False)


def is_placeholder_image_for_export(image_path: str | Path) -> bool:
    """Compatibility mode for Quail export image filtering."""
    return is_placeholder_image(image_path, detect_mostly_white=True)

