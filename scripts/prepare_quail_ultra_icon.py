#!/usr/bin/env python3

from collections import deque
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "branding" / "quail-ultra-icon-input.png"
CLEANED = ROOT / "branding" / "quail-ultra-icon-source.png"
PNG_OUT = ROOT / "branding" / "quail-ultra.png"
ICO_OUT = ROOT / "branding" / "quail-ultra.ico"


def is_background(pixel):
    r, g, b, a = pixel
    return a > 0 and r <= 18 and g <= 18 and b <= 18


def main():
    image = Image.open(SOURCE).convert("RGBA")
    pixels = image.load()
    width, height = image.size

    queue = deque()
    visited = set()

    def enqueue(x, y):
      if (x, y) in visited:
        return
      visited.add((x, y))
      queue.append((x, y))

    for x in range(width):
        enqueue(x, 0)
        enqueue(x, height - 1)
    for y in range(height):
        enqueue(0, y)
        enqueue(width - 1, y)

    while queue:
        x, y = queue.popleft()
        if not is_background(pixels[x, y]):
            continue

        pixels[x, y] = (0, 0, 0, 0)

        if x > 0:
            enqueue(x - 1, y)
        if x < width - 1:
            enqueue(x + 1, y)
        if y > 0:
            enqueue(x, y - 1)
        if y < height - 1:
            enqueue(x, y + 1)

    bbox = image.getbbox()
    if bbox is None:
        raise RuntimeError("Icon became empty after background cleanup.")

    cropped = image.crop(bbox)

    pad = int(max(cropped.size) * 0.08)
    padded = Image.new("RGBA", (cropped.width + pad * 2, cropped.height + pad * 2), (0, 0, 0, 0))
    padded.paste(cropped, (pad, pad))

    final = padded.resize((1024, 1024), Image.LANCZOS)
    final.save(CLEANED)
    final.save(PNG_OUT)
    final.save(ICO_OUT, sizes=[(16, 16), (32, 32), (64, 64), (128, 128), (256, 256)])


if __name__ == "__main__":
    main()
