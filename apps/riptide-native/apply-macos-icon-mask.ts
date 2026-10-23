#!/usr/bin/env bun

/**
 * Apply macOS squircle mask and padding to an icon
 *
 * This script takes a source PNG and applies:
 * 1. Apple's continuous rounded rectangle (squircle) mask
 * 2. 100px transparent padding on all sides
 *
 * The result is a 1024x1024 PNG with 824x824 content area,
 * compatible with macOS Big Sur through Tahoe.
 *
 * Usage: bun apply-macos-icon-mask.ts <source.png> [output.png]
 */

import { parseArgs } from 'node:util'

import sharp from 'sharp'

// Apple's continuous rounded rectangle uses these Bézier curve constants
// Based on research from https://liamrosenfeld.com/posts/apple_icon_quest/
const CORNER_RADIUS_RATIO = 0.22544 // ~185.4px on 824px content = 22.5%

/**
 * Generate SVG path for Apple's continuous rounded rectangle (squircle)
 *
 * Apple doesn't use simple circular arcs - they use cubic Bézier curves
 * that create a smooth, continuous curvature throughout the corner.
 *
 * The key insight: the control points are positioned to create
 * a "superellipse-like" curve without the mathematical discontinuities.
 */
function generateSquirclePath(size: number, cornerRadius: number): string {
	// Control point multiplier for the Bézier curves
	// This value approximates Apple's continuous rounded rectangle
	// Standard circular arc would use 0.5523 (4/3 * (sqrt(2) - 1))
	// Apple uses a higher value for smoother corners: ~0.6
	const k = 0.6

	const r = cornerRadius
	const w = size
	const h = size

	// Start at top-left, after the corner
	// Move clockwise around the rectangle
	return `
    M ${r} 0
    L ${w - r} 0
    C ${w - r + r * k} 0, ${w} ${r - r * k}, ${w} ${r}
    L ${w} ${h - r}
    C ${w} ${h - r + r * k}, ${w - r + r * k} ${h}, ${w - r} ${h}
    L ${r} ${h}
    C ${r - r * k} ${h}, 0 ${h - r + r * k}, 0 ${h - r}
    L 0 ${r}
    C 0 ${r - r * k}, ${r - r * k} 0, ${r} 0
    Z
  `.trim()
}

/**
 * Generate the squircle mask as an SVG buffer that sharp can process
 */
function generateMaskSvg(contentSize: number, padding: number, cornerRadius: number): Buffer {
	const totalSize = contentSize + padding * 2
	const path = generateSquirclePath(contentSize, cornerRadius)

	const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${totalSize}" height="${totalSize}" viewBox="0 0 ${totalSize} ${totalSize}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${totalSize}" height="${totalSize}" fill="black"/>
  <g transform="translate(${padding}, ${padding})">
    <path d="${path}" fill="white"/>
  </g>
</svg>`

	return Buffer.from(svg)
}

async function applyMacOSIconMask(sourcePath: string, outputPath: string): Promise<void> {
	const FINAL_SIZE = 1024
	const PADDING = 100
	const CONTENT_SIZE = FINAL_SIZE - PADDING * 2 // 824
	const CORNER_RADIUS = Math.round(CONTENT_SIZE * CORNER_RADIUS_RATIO) // ~185

	console.log(`Applying macOS icon mask to: ${sourcePath}`)
	console.log(`  Final size: ${FINAL_SIZE}x${FINAL_SIZE}`)
	console.log(`  Content area: ${CONTENT_SIZE}x${CONTENT_SIZE}`)
	console.log(`  Padding: ${PADDING}px`)
	console.log(`  Corner radius: ${CORNER_RADIUS}px`)

	// Generate the mask SVG (white squircle on black background)
	const maskSvgBuffer = generateMaskSvg(CONTENT_SIZE, PADDING, CORNER_RADIUS)

	// Load and resize source image to content size (keep as PNG for compositing)
	const sourceImage = await sharp(sourcePath)
		.resize(CONTENT_SIZE, CONTENT_SIZE, {
			fit: 'cover',
			position: 'center',
		})
		.png()
		.toBuffer()

	// Create the mask from SVG - get raw pixel data
	const maskRaw = await sharp(maskSvgBuffer)
		.resize(FINAL_SIZE, FINAL_SIZE)
		.extractChannel('red') // Get just one channel (mask is B&W)
		.raw()
		.toBuffer()

	// Create a canvas at final size with the source centered, get as raw RGB
	const centeredSourceRaw = await sharp({
		create: {
			width: FINAL_SIZE,
			height: FINAL_SIZE,
			channels: 3,
			background: { r: 0, g: 0, b: 0 },
		},
	})
		.composite([
			{
				input: sourceImage,
				left: PADDING,
				top: PADDING,
			},
		])
		.removeAlpha()
		.raw()
		.toBuffer()

	// Manually combine RGB from source with alpha from mask
	const rgbaBuffer = Buffer.alloc(FINAL_SIZE * FINAL_SIZE * 4)
	for (let i = 0; i < FINAL_SIZE * FINAL_SIZE; i++) {
		rgbaBuffer[i * 4 + 0] = centeredSourceRaw[i * 3 + 0] // R
		rgbaBuffer[i * 4 + 1] = centeredSourceRaw[i * 3 + 1] // G
		rgbaBuffer[i * 4 + 2] = centeredSourceRaw[i * 3 + 2] // B
		rgbaBuffer[i * 4 + 3] = maskRaw[i] // A from mask
	}

	// Create final image from raw RGBA data
	await sharp(rgbaBuffer, {
		raw: {
			width: FINAL_SIZE,
			height: FINAL_SIZE,
			channels: 4,
		},
	})
		.png()
		.toFile(outputPath)

	console.log(`\n✓ Output saved to: ${outputPath}`)
}

// CLI handling
const { values, positionals } = parseArgs({
	args: Bun.argv.slice(2),
	allowPositionals: true,
	options: {
		help: { type: 'boolean', short: 'h' },
	},
})

if (values.help || positionals.length === 0) {
	console.log(`
Usage: bun apply-macos-icon-mask.ts <source.png> [output.png]

Applies Apple's squircle mask and 100px padding to create a
macOS-compatible app icon (1024x1024 with 824x824 content area).

Arguments:
  source.png    Input PNG file (any size, will be resized)
  output.png    Output file (default: source-macos.png)

Example:
  bun apply-macos-icon-mask.ts logo.png icon-macos.png
`)
	process.exit(0)
}

const sourcePath = positionals[0]
const outputPath = positionals[1] || sourcePath.replace(/\.png$/, '-macos.png')

await applyMacOSIconMask(sourcePath, outputPath)
