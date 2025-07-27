#!/bin/bash

# Script to generate rounded corner icons using macOS native tools
# Uses Core Image filters via sips

set -e

SOURCE_ICON="/Users/dex/go/src/github.com/metalytics-dev/metalytics/app/public/humanlayer-dark.png"
ICON_DIR="/Users/dex/wt/humanlayer/eng-1689/humanlayer-wui/src-tauri/icons"

# Create a Swift script to add rounded corners
cat > /tmp/round_corners.swift << 'EOF'
import Cocoa
import CoreImage

let args = CommandLine.arguments
if args.count < 4 {
    print("Usage: round_corners.swift <input> <output> <size>")
    exit(1)
}

let inputPath = args[1]
let outputPath = args[2]
let size = Int(args[3]) ?? 512

// Load image
guard let image = NSImage(contentsOfFile: inputPath) else {
    print("Failed to load image")
    exit(1)
}

// Create bitmap representation
let targetSize = NSSize(width: size, height: size)
let bitmapRep = NSBitmapImageRep(
    bitmapDataPlanes: nil,
    pixelsWide: size,
    pixelsHigh: size,
    bitsPerSample: 8,
    samplesPerPixel: 4,
    hasAlpha: true,
    isPlanar: false,
    colorSpaceName: .deviceRGB,
    bytesPerRow: 0,
    bitsPerPixel: 0
)!

// Draw with rounded corners
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmapRep)

let rect = NSRect(x: 0, y: 0, width: size, height: size)
let radius = CGFloat(size) / 5.0  // 20% corner radius

// Create rounded rectangle path
let path = NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius)
path.addClip()

// Draw the image
image.draw(in: rect, from: NSRect(origin: .zero, size: image.size), operation: .sourceOver, fraction: 1.0)

NSGraphicsContext.restoreGraphicsState()

// Save as PNG
guard let data = bitmapRep.representation(using: .png, properties: [:]) else {
    print("Failed to create PNG data")
    exit(1)
}

do {
    try data.write(to: URL(fileURLWithPath: outputPath))
    print("Saved: \(outputPath)")
} catch {
    print("Failed to save image: \(error)")
    exit(1)
}
EOF

# Compile the Swift script
echo "Compiling Swift helper..."
swiftc /tmp/round_corners.swift -o /tmp/round_corners

# Function to create rounded icon using Swift tool
create_rounded_icon() {
    local size=$1
    local output=$2

    echo "Creating $output ($size x $size)..."
    /tmp/round_corners "$SOURCE_ICON" "$output" "$size"
}

# Generate all required sizes
echo "Generating rounded corner icons..."

create_rounded_icon 512 "$ICON_DIR/icon.png"
create_rounded_icon 32 "$ICON_DIR/32x32.png"
create_rounded_icon 128 "$ICON_DIR/128x128.png"
create_rounded_icon 256 "$ICON_DIR/128x128@2x.png"

# Windows Store icons
for size in 30 44 71 89 107 142 150 284 310; do
    create_rounded_icon $size "$ICON_DIR/Square${size}x${size}Logo.png"
done
create_rounded_icon 50 "$ICON_DIR/StoreLogo.png"

# Generate iconset for macOS .icns
echo "Creating macOS iconset..."
mkdir -p /tmp/icon.iconset

create_rounded_icon 16 /tmp/icon.iconset/icon_16x16.png
create_rounded_icon 32 /tmp/icon.iconset/icon_16x16@2x.png
create_rounded_icon 32 /tmp/icon.iconset/icon_32x32.png
create_rounded_icon 64 /tmp/icon.iconset/icon_32x32@2x.png
create_rounded_icon 128 /tmp/icon.iconset/icon_128x128.png
create_rounded_icon 256 /tmp/icon.iconset/icon_128x128@2x.png
create_rounded_icon 256 /tmp/icon.iconset/icon_256x256.png
create_rounded_icon 512 /tmp/icon.iconset/icon_256x256@2x.png
create_rounded_icon 512 /tmp/icon.iconset/icon_512x512.png
cp "$ICON_DIR/icon.png" /tmp/icon.iconset/icon_512x512@2x.png

# Convert to .icns
echo "Converting to .icns format..."
iconutil -c icns /tmp/icon.iconset -o "$ICON_DIR/icon.icns"

# Cleanup
rm -rf /tmp/icon.iconset
rm -f /tmp/round_corners.swift /tmp/round_corners

echo "Done! All icons have been generated with rounded corners."
echo "Note: Windows .ico file kept as-is (Windows doesn't typically use rounded corners)"
