#!/usr/bin/env -S uv run
# /// script
# dependencies = [
#     "pillow",
# ]
# ///

import os
import subprocess
from pathlib import Path
from PIL import Image, ImageDraw

SOURCE_ICON = "/Users/dex/go/src/github.com/metalytics-dev/metalytics/app/public/humanlayer-dark.png"
ICON_DIR = "/Users/dex/wt/humanlayer/eng-1689/humanlayer-wui/src-tauri/icons"

def create_rounded_corners_mask(size, radius):
    """Create a mask for rounded corners"""
    mask = Image.new('L', (size, size), 0)
    draw = ImageDraw.Draw(mask)
    
    # Draw a rounded rectangle
    draw.rounded_rectangle([(0, 0), (size-1, size-1)], radius=radius, fill=255)
    
    return mask

def create_rounded_icon(source_path, output_path, size):
    """Create a rounded corner icon at the specified size"""
    # Open and resize the source image
    img = Image.open(source_path)
    img = img.convert("RGBA")
    img = img.resize((size, size), Image.Resampling.LANCZOS)
    
    # Create a rounded corners mask
    radius = size // 5  # 20% corner radius
    mask = create_rounded_corners_mask(size, radius)
    
    # Create output image with transparent background
    output = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    output.paste(img, (0, 0))
    
    # Apply the mask to the alpha channel
    output.putalpha(mask)
    
    # Save the result
    output.save(output_path, 'PNG')
    print(f"Created: {output_path} ({size}x{size})")

def main():
    print("Generating rounded corner icons...")
    
    # Ensure icon directory exists
    os.makedirs(ICON_DIR, exist_ok=True)
    
    # Generate main icons
    create_rounded_icon(SOURCE_ICON, f"{ICON_DIR}/icon.png", 512)
    create_rounded_icon(SOURCE_ICON, f"{ICON_DIR}/32x32.png", 32)
    create_rounded_icon(SOURCE_ICON, f"{ICON_DIR}/128x128.png", 128)
    create_rounded_icon(SOURCE_ICON, f"{ICON_DIR}/128x128@2x.png", 256)
    
    # Generate Windows Store icons
    for size in [30, 44, 71, 89, 107, 142, 150, 284, 310]:
        create_rounded_icon(SOURCE_ICON, f"{ICON_DIR}/Square{size}x{size}Logo.png", size)
    
    create_rounded_icon(SOURCE_ICON, f"{ICON_DIR}/StoreLogo.png", 50)
    
    # Generate iconset for macOS
    print("\nCreating macOS iconset...")
    iconset_dir = "/tmp/icon.iconset"
    os.makedirs(iconset_dir, exist_ok=True)
    
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
        (512, "icon_512x512@2x.png"),  # Will copy from icon.png
    ]
    
    for size, filename in icon_sizes:
        if filename == "icon_512x512@2x.png":
            # Just copy the already generated icon
            subprocess.run(["cp", f"{ICON_DIR}/icon.png", f"{iconset_dir}/{filename}"])
        else:
            create_rounded_icon(SOURCE_ICON, f"{iconset_dir}/{filename}", size)
    
    # Convert to .icns
    print("\nConverting to .icns format...")
    subprocess.run(["iconutil", "-c", "icns", iconset_dir, "-o", f"{ICON_DIR}/icon.icns"])
    
    # Cleanup
    subprocess.run(["rm", "-rf", iconset_dir])
    
    print("\nDone! All icons have been generated with rounded corners.")
    print("Note: Windows .ico file kept as-is (Windows doesn't typically use rounded corners)")

if __name__ == "__main__":
    main()