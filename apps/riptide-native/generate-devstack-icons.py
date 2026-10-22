#!/usr/bin/env -S uv run --script
#
# /// script
# requires-python = ">=3.12"
# dependencies = ["pillow>=11.0.0"]
# ///

from colorsys import hsv_to_rgb, rgb_to_hsv
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).parent
SOURCE = ROOT / "icons" / "icon.png"
OUTPUT = ROOT / "icons" / "devstack"
HUE_ROTATIONS = (30, 75, 120, 180, 240, 300)


def rotate_hue(image: Image.Image, degrees: int) -> Image.Image:
    pixels = []
    for red, green, blue, alpha in image.convert("RGBA").get_flattened_data():
        if alpha == 0:
            pixels.append((red, green, blue, alpha))
            continue
        hue, saturation, value = rgb_to_hsv(red / 255, green / 255, blue / 255)
        rotated = hsv_to_rgb((hue + degrees / 360) % 1, saturation, value)
        pixels.append((*[round(channel * 255) for channel in rotated], alpha))

    result = Image.new("RGBA", image.size)
    result.putdata(pixels)
    return result


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    source = Image.open(SOURCE)
    for index, degrees in enumerate(HUE_ROTATIONS, start=1):
        rotate_hue(source, degrees).save(OUTPUT / f"icon-{index}.png", optimize=True)


if __name__ == "__main__":
    main()
