#!/bin/bash

# Script to generate all required icon formats for Tauri from riptide.png
# Requires: ImageMagick (brew install imagemagick)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_ICON="${SCRIPT_DIR}/riptide.png"
OUTPUT_DIR="${SCRIPT_DIR}/icons"

# Check if source icon exists
if [ ! -f "$SOURCE_ICON" ]; then
    echo "Error: Source icon not found at $SOURCE_ICON"
    exit 1
fi

# Check if ImageMagick is installed
if ! command -v convert &> /dev/null; then
    echo "Error: ImageMagick is not installed. Install it with: brew install imagemagick"
    exit 1
fi

# Create output directory if it doesn't exist
mkdir -p "$OUTPUT_DIR"

echo "Generating Tauri icons from $SOURCE_ICON..."

# Generate PNG icons at various sizes (ensure RGBA format with -type TrueColorAlpha)
echo "Generating PNG icons..."
convert "$SOURCE_ICON" -resize 32x32 -type TrueColorAlpha PNG32:"$OUTPUT_DIR/32x32.png"
convert "$SOURCE_ICON" -resize 128x128 -type TrueColorAlpha PNG32:"$OUTPUT_DIR/128x128.png"
convert "$SOURCE_ICON" -resize 256x256 -type TrueColorAlpha PNG32:"$OUTPUT_DIR/128x128@2x.png"
convert "$SOURCE_ICON" -resize 512x512 -type TrueColorAlpha PNG32:"$OUTPUT_DIR/icon.png"

# Generate Windows Store icons (ensure RGBA format)
echo "Generating Windows Store icons..."
convert "$SOURCE_ICON" -resize 30x30 -type TrueColorAlpha PNG32:"$OUTPUT_DIR/Square30x30Logo.png"
convert "$SOURCE_ICON" -resize 44x44 -type TrueColorAlpha PNG32:"$OUTPUT_DIR/Square44x44Logo.png"
convert "$SOURCE_ICON" -resize 71x71 -type TrueColorAlpha PNG32:"$OUTPUT_DIR/Square71x71Logo.png"
convert "$SOURCE_ICON" -resize 89x89 -type TrueColorAlpha PNG32:"$OUTPUT_DIR/Square89x89Logo.png"
convert "$SOURCE_ICON" -resize 107x107 -type TrueColorAlpha PNG32:"$OUTPUT_DIR/Square107x107Logo.png"
convert "$SOURCE_ICON" -resize 142x142 -type TrueColorAlpha PNG32:"$OUTPUT_DIR/Square142x142Logo.png"
convert "$SOURCE_ICON" -resize 150x150 -type TrueColorAlpha PNG32:"$OUTPUT_DIR/Square150x150Logo.png"
convert "$SOURCE_ICON" -resize 284x284 -type TrueColorAlpha PNG32:"$OUTPUT_DIR/Square284x284Logo.png"
convert "$SOURCE_ICON" -resize 310x310 -type TrueColorAlpha PNG32:"$OUTPUT_DIR/Square310x310Logo.png"
convert "$SOURCE_ICON" -resize 50x50 -type TrueColorAlpha PNG32:"$OUTPUT_DIR/StoreLogo.png"

# Generate ICO file (Windows icon)
echo "Generating Windows ICO file..."
convert "$SOURCE_ICON" -resize 256x256 -define icon:auto-resize=256,128,64,48,32,16 "$OUTPUT_DIR/icon.ico"

# Generate ICNS file (macOS icon)
echo "Generating macOS ICNS file..."
# Create temporary directory for ICNS generation
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

# Generate all required sizes for ICNS (ensure RGBA format)
convert "$SOURCE_ICON" -resize 16x16 -type TrueColorAlpha PNG32:"$TEMP_DIR/icon_16x16.png"
convert "$SOURCE_ICON" -resize 32x32 -type TrueColorAlpha PNG32:"$TEMP_DIR/icon_16x16@2x.png"
convert "$SOURCE_ICON" -resize 32x32 -type TrueColorAlpha PNG32:"$TEMP_DIR/icon_32x32.png"
convert "$SOURCE_ICON" -resize 64x64 -type TrueColorAlpha PNG32:"$TEMP_DIR/icon_32x32@2x.png"
convert "$SOURCE_ICON" -resize 128x128 -type TrueColorAlpha PNG32:"$TEMP_DIR/icon_128x128.png"
convert "$SOURCE_ICON" -resize 256x256 -type TrueColorAlpha PNG32:"$TEMP_DIR/icon_128x128@2x.png"
convert "$SOURCE_ICON" -resize 256x256 -type TrueColorAlpha PNG32:"$TEMP_DIR/icon_256x256.png"
convert "$SOURCE_ICON" -resize 512x512 -type TrueColorAlpha PNG32:"$TEMP_DIR/icon_256x256@2x.png"
convert "$SOURCE_ICON" -resize 512x512 -type TrueColorAlpha PNG32:"$TEMP_DIR/icon_512x512.png"
convert "$SOURCE_ICON" -resize 1024x1024 -type TrueColorAlpha PNG32:"$TEMP_DIR/icon_512x512@2x.png"

# Use iconutil to create ICNS file (macOS only)
if command -v iconutil &> /dev/null; then
    # Create iconset directory
    ICONSET_DIR="$TEMP_DIR/icon.iconset"
    mkdir -p "$ICONSET_DIR"

    # Move files to iconset with correct names
    cp "$TEMP_DIR/icon_16x16.png" "$ICONSET_DIR/icon_16x16.png"
    cp "$TEMP_DIR/icon_16x16@2x.png" "$ICONSET_DIR/icon_16x16@2x.png"
    cp "$TEMP_DIR/icon_32x32.png" "$ICONSET_DIR/icon_32x32.png"
    cp "$TEMP_DIR/icon_32x32@2x.png" "$ICONSET_DIR/icon_32x32@2x.png"
    cp "$TEMP_DIR/icon_128x128.png" "$ICONSET_DIR/icon_128x128.png"
    cp "$TEMP_DIR/icon_128x128@2x.png" "$ICONSET_DIR/icon_128x128@2x.png"
    cp "$TEMP_DIR/icon_256x256.png" "$ICONSET_DIR/icon_256x256.png"
    cp "$TEMP_DIR/icon_256x256@2x.png" "$ICONSET_DIR/icon_256x256@2x.png"
    cp "$TEMP_DIR/icon_512x512.png" "$ICONSET_DIR/icon_512x512.png"
    cp "$TEMP_DIR/icon_512x512@2x.png" "$ICONSET_DIR/icon_512x512@2x.png"

    # Generate ICNS
    iconutil -c icns "$ICONSET_DIR" -o "$OUTPUT_DIR/icon.icns"
    echo "✓ Generated ICNS file using iconutil"
else
    echo "⚠️  Warning: iconutil not found (not on macOS?). Using png2icns fallback..."
    # Try png2icns as fallback
    if command -v png2icns &> /dev/null; then
        png2icns "$OUTPUT_DIR/icon.icns" "$TEMP_DIR/icon_16x16.png" "$TEMP_DIR/icon_32x32.png" "$TEMP_DIR/icon_128x128.png" "$TEMP_DIR/icon_256x256.png" "$TEMP_DIR/icon_512x512.png"
        echo "✓ Generated ICNS file using png2icns"
    else
        echo "❌ Error: Neither iconutil nor png2icns found. Cannot generate ICNS file."
        echo "   On macOS: iconutil should be available by default"
        echo "   On Linux: Install libicns with: sudo apt-get install libicns-utils"
    fi
fi

echo ""
echo "✅ Icon generation complete!"
echo "   Output directory: $OUTPUT_DIR"
echo ""
echo "Generated files:"
ls -la "$OUTPUT_DIR" | grep -E "\.(png|ico|icns)$"
