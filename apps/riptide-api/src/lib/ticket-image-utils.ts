/**
 * Utilities for extracting and downloading images from ticket content (Linear, Jira).
 */

import { Option, Schema } from 'effect'

const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'] as const
const ImageExtension = Schema.Literals(IMAGE_EXTENSIONS)
type ImageExtension = (typeof IMAGE_EXTENSIONS)[number]
const IMAGE_EXTENSION_PATTERN = new RegExp(`\\.(${IMAGE_EXTENSIONS.join('|')})(\\?|$)`, 'i')

const CONTENT_TYPES: Record<ImageExtension, string> = {
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	png: 'image/png',
	gif: 'image/gif',
	webp: 'image/webp',
	svg: 'image/svg+xml',
	bmp: 'image/bmp',
}

/**
 * Extract image URLs from markdown content.
 * Matches markdown image syntax: ![altText](url)
 * Only returns URLs that look like actual images (from uploads.linear.app or with image extensions).
 */
export function extractImageUrls(markdown: string): Array<{ url: string; altText: string }> {
	const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g
	const images: Array<{ url: string; altText: string }> = []

	for (const match of markdown.matchAll(imageRegex)) {
		const altText = match[1] || 'image'
		const url = match[2]
		if (!url) continue

		// Only include URLs that look like image URLs
		if (
			url.startsWith('http') &&
			(url.includes('uploads.linear.app') ||
				url.includes('github.com/user-attachments/assets/') ||
				IMAGE_EXTENSION_PATTERN.test(url))
		) {
			images.push({ url, altText })
		}
	}

	return images
}

/**
 * Get file extension from URL or fall back to png.
 */
export function getFileExtension(url: string): string {
	try {
		const urlObj = new URL(url)
		const pathname = urlObj.pathname
		const match = pathname.match(/\.([a-zA-Z0-9]+)$/)
		if (match?.[1]) {
			return match[1].toLowerCase()
		}
	} catch {
		// Invalid URL, fall through to default
	}
	return 'png'
}

/**
 * Extract a reasonable filename from a URL.
 * Returns a sanitized filename without extension.
 */
export function extractFilenameFromUrl(url: string): string {
	try {
		const urlObj = new URL(url)
		const pathname = urlObj.pathname
		// Get last path segment
		const segments = pathname.split('/').filter(Boolean)
		const lastSegment = segments[segments.length - 1] || 'image'
		// Remove extension and sanitize
		const withoutExt = lastSegment.replace(/\.[a-zA-Z0-9]+$/, '')
		// Sanitize: replace non-alphanumeric with dashes, collapse multiple dashes
		const sanitized = withoutExt
			.replace(/[^a-zA-Z0-9-_]/g, '-')
			.replace(/-+/g, '-')
			.replace(/^-|-$/g, '')
		return sanitized || 'image'
	} catch {
		return 'image'
	}
}

/**
 * Get the content type based on file extension.
 */
export function getContentType(extension: string): string {
	const parsedExtension = Option.getOrUndefined(Schema.decodeUnknownOption(ImageExtension)(extension.toLowerCase()))
	return parsedExtension ? CONTENT_TYPES[parsedExtension] : 'application/octet-stream'
}

/**
 * Download an image from a URL.
 * @param url - Image URL
 * @param authHeader - Optional auth header (e.g., "Bearer token" for Linear, "Basic ..." for Jira)
 * @returns Buffer, content type, and suggested filename
 */
export async function downloadTicketImage(
	url: string,
	authHeader?: string,
	maxBytes = 50 * 1024 * 1024,
): Promise<{ buffer: Buffer; contentType: string; filename: string }> {
	const headers: Record<string, string> = {}

	// If URL contains a signature parameter, it's already authenticated (signed URL)
	// Otherwise, add auth header for Linear uploads
	if (url.includes('uploads.linear.app') && !url.includes('signature=') && authHeader) {
		headers.Authorization = authHeader
	}

	const response = await fetch(url, { headers })

	if (!response.ok) {
		throw new Error(`Failed to download image: ${response.status} ${response.statusText}`)
	}
	const declaredLength = Number(response.headers.get('content-length') ?? 0)
	if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
		throw new Error(`Image exceeds ${maxBytes} byte limit`)
	}

	if (!response.body) throw new Error('Image response has no body')
	const reader = response.body.getReader()
	const chunks: Uint8Array[] = []
	let byteLength = 0
	while (true) {
		const { done, value } = await reader.read()
		if (done) break
		byteLength += value.byteLength
		if (byteLength > maxBytes) {
			await reader.cancel()
			throw new Error(`Image exceeds ${maxBytes} byte limit`)
		}
		chunks.push(value)
	}
	const buffer = Buffer.concat(
		chunks.map((chunk) => Buffer.from(chunk)),
		byteLength,
	)

	// Determine content type from response or URL
	const responseContentType = response.headers.get('content-type')
	const extension = getFileExtension(url)
	const contentType = responseContentType || getContentType(extension)

	// Extract filename from URL
	const baseFilename = extractFilenameFromUrl(url)
	const filename = `${baseFilename}.${extension}`

	return { buffer, contentType, filename }
}
