import { mkdir } from 'node:fs/promises'
import * as path from 'path'
import { URL } from 'url'

import { write } from 'bun'
import fetch from 'node-fetch'

/**
 * Extract image URLs from markdown content
 */
export function extractImageUrls(markdown: string): Array<{ url: string; altText: string }> {
	const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g
	const images: Array<{ url: string; altText: string }> = []
	let match

	while ((match = imageRegex.exec(markdown)) !== null) {
		const altText = match[1] || 'image'
		const url = match[2]
		if (!url) continue

		// Only include URLs that look like image URLs
		if (
			url.startsWith('http') &&
			(url.includes('uploads.linear.app') || url.match(/\.(jpg|jpeg|png|gif|webp|svg|bmp)(\?|$)/i))
		) {
			images.push({ url, altText })
		}
	}

	return images
}

/**
 * Get file extension from URL or alt text
 */
export function getFileExtension(url: string, altText: string): string {
	// Try to get extension from URL
	try {
		const urlObj = new URL(url)
		const pathname = urlObj.pathname
		const match = pathname.match(/\.([a-zA-Z0-9]+)$/)
		if (match?.[1]) {
			return match[1].toLowerCase()
		}
	} catch {}

	// Try to get extension from alt text
	const altMatch = altText.match(/\.([a-zA-Z0-9]+)$/)
	if (altMatch?.[1]) {
		return altMatch[1].toLowerCase()
	}

	// Default to png
	return 'png'
}

/**
 * Download image from URL to local path
 * @param url - Image URL
 * @param outputPath - Local file path to save to
 * @param token - Optional auth token (API key or OAuth access token)
 */
export async function downloadImage(url: string, outputPath: string, token?: string): Promise<void> {
	// If URL contains a signature parameter, it's already authenticated (signed URL)
	// Otherwise, add Bearer token for Linear uploads
	const headers: Record<string, string> = {}
	if (url.includes('uploads.linear.app') && !url.includes('signature=') && token) {
		headers['Authorization'] = `Bearer ${token}`
	}

	const response = await fetch(url, { headers })

	if (!response.ok) {
		throw new Error(`Failed to download image: ${response.status} ${response.statusText}`)
	}

	const buffer = await response.buffer()

	// Ensure directory exists
	const dir = path.dirname(outputPath)
	await mkdir(dir, { recursive: true })

	await write(outputPath, buffer)
}

/**
 * Get the thoughts/images directory path for a given issue ID
 */
export function getThoughtsImagesPath(issueId: string): string {
	// Construct path relative to current working directory
	const thoughtsDir = path.join(process.cwd(), 'thoughts', 'shared', 'images', issueId.toUpperCase())
	return thoughtsDir
}
