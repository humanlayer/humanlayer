#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "pillow",
# ]
# ///

import os
import subprocess
from pathlib import Path
from PIL import Image

# Get paths relative to script location
SCRIPT_DIR = Path(__file__).parent.absolute()
SOURCE_ICON = SCRIPT_DIR / "codelayer-icon-nightly.png"
ICON_DIR = SCRIPT_DIR.parent / "humanlayer-wui" / "src-tauri" / "icons-nightly"


def create_rounded_icon(source_path, output_path, size):
    """Resize icon while preserving transparency and existing rounded corners"""
    # Open and resize the source image
    img = Image.open(source_path)
    img = img.convert("RGBA")
    img = img.resize((size, size), Image.Resampling.LANCZOS)
    
    # Save the result directly - preserves transparency and existing rounded corners
    img.save(output_path, "PNG")
    print(f"Created: {output_path} ({size}x{size})")


def main():
    print("Generating nightly icons from CodeLayer dark icon...")

    # Ensure icon directory exists
    ICON_DIR.mkdir(parents=True, exist_ok=True)

    # Generate main icons
    create_rounded_icon(str(SOURCE_ICON), str(ICON_DIR / "icon.png"), 512)
    create_rounded_icon(str(SOURCE_ICON), str(ICON_DIR / "32x32.png"), 32)
    create_rounded_icon(str(SOURCE_ICON), str(ICON_DIR / "128x128.png"), 128)
    create_rounded_icon(str(SOURCE_ICON), str(ICON_DIR / "128x128@2x.png"), 256)
    create_rounded_icon(str(SOURCE_ICON), str(ICON_DIR / "256x256.png"), 256)
    create_rounded_icon(str(SOURCE_ICON), str(ICON_DIR / "512x512.png"), 512)

    # Generate Windows Store icons
    for size in [30, 44, 71, 89, 107, 142, 150, 284, 310]:
        create_rounded_icon(str(SOURCE_ICON), str(ICON_DIR / f"Square{size}x{size}Logo.png"), size)

    create_rounded_icon(str(SOURCE_ICON), str(ICON_DIR / "StoreLogo.png"), 50)

    # Generate iconset for macOS
    print("\nCreating macOS iconset...")
    iconset_dir = Path("/tmp/icon.iconset")
    iconset_dir.mkdir(parents=True, exist_ok=True)

    # Standard macOS icon sizes
    icon_sizes = [
        (16, "icon_16x16.png"),
        (32, "icon_16x16@2x.png"),
        (32, "icon_32x32.png"),
        (64, "icon_32x32@2x.png"),
        (128, "icon_128x128.png"),
        (256, "icon_128x128@2x.png"),
        (256, "icon_256x256.png"),
        (512, "icon_256x256@2x.png"),
        (512, "icon_512x512.png"),
        (1024, "icon_512x512@2x.png"),
    ]

    for size, filename in icon_sizes:
        create_rounded_icon(str(SOURCE_ICON), str(iconset_dir / filename), size)

    # Convert to .icns
    print("\nConverting to .icns format...")
    subprocess.run(["iconutil", "-c", "icns", str(iconset_dir), "-o", str(ICON_DIR / "icon.icns")])

    # Generate Windows .ico file
    print("\nGenerating Windows .ico file...")
    img = Image.open(str(SOURCE_ICON))
    img.save(str(ICON_DIR / "icon.ico"), format="ICO", sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])

    # Cleanup
    subprocess.run(["rm", "-rf", str(iconset_dir)])

    print("\nDone! All nightly icons have been generated.")
    print(f"Output directory: {ICON_DIR}")


if __name__ == "__main__":
    main()