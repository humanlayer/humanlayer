import { describe, expect, test } from 'vitest'

import { extractFilenameFromUrl, extractImageUrls, getContentType, getFileExtension } from './ticket-image-utils'

describe('extractImageUrls', () => {
	test('extracts markdown images from Linear uploads', () => {
		const markdown = `
Some text here
![screenshot](https://uploads.linear.app/abc123/def456.png)
More text
![another](https://uploads.linear.app/xyz789/image.jpg)
`
		const result = extractImageUrls(markdown)
		expect(result).toEqual([
			{ url: 'https://uploads.linear.app/abc123/def456.png', altText: 'screenshot' },
			{ url: 'https://uploads.linear.app/xyz789/image.jpg', altText: 'another' },
		])
	})

	test('extracts images with standard image extensions', () => {
		const markdown = '![img](https://example.com/photo.jpg)'
		const result = extractImageUrls(markdown)
		expect(result).toEqual([{ url: 'https://example.com/photo.jpg', altText: 'img' }])
	})

	test('handles images with query parameters', () => {
		const markdown = '![img](https://example.com/photo.png?size=large)'
		const result = extractImageUrls(markdown)
		expect(result).toEqual([{ url: 'https://example.com/photo.png?size=large', altText: 'img' }])
	})

	test('ignores non-http URLs', () => {
		const markdown = '![local](./local-image.png)'
		const result = extractImageUrls(markdown)
		expect(result).toEqual([])
	})

	test('ignores URLs without image extensions (unless Linear)', () => {
		const markdown = '![doc](https://example.com/document.pdf)'
		const result = extractImageUrls(markdown)
		expect(result).toEqual([])
	})

	test('includes Linear URLs without standard extensions', () => {
		const markdown = '![screenshot](https://uploads.linear.app/abc123/file)'
		const result = extractImageUrls(markdown)
		expect(result).toEqual([{ url: 'https://uploads.linear.app/abc123/file', altText: 'screenshot' }])
	})

	test('defaults altText to "image" when empty', () => {
		const markdown = '![](https://uploads.linear.app/abc123/test.png)'
		const result = extractImageUrls(markdown)
		expect(result).toEqual([{ url: 'https://uploads.linear.app/abc123/test.png', altText: 'image' }])
	})

	test('handles multiple images in same line', () => {
		const markdown = '![a](https://uploads.linear.app/1.png) and ![b](https://uploads.linear.app/2.png)'
		const result = extractImageUrls(markdown)
		expect(result).toHaveLength(2)
	})

	test('returns empty array for content without images', () => {
		const markdown = 'Just some text without any images'
		const result = extractImageUrls(markdown)
		expect(result).toEqual([])
	})

	test('handles all supported image extensions', () => {
		const extensions = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp']
		for (const ext of extensions) {
			const markdown = `![img](https://example.com/image.${ext})`
			const result = extractImageUrls(markdown)
			expect(result).toHaveLength(1)
		}
	})

	test('case insensitive extension matching', () => {
		const markdown = '![img](https://example.com/image.PNG)'
		const result = extractImageUrls(markdown)
		expect(result).toHaveLength(1)
	})
})

describe('getFileExtension', () => {
	test('extracts extension from simple URL', () => {
		expect(getFileExtension('https://example.com/image.png')).toBe('png')
	})

	test('extracts extension from URL with path', () => {
		expect(getFileExtension('https://example.com/uploads/2024/photo.jpg')).toBe('jpg')
	})

	test('extracts extension from URL with query params', () => {
		expect(getFileExtension('https://example.com/image.gif?size=large')).toBe('gif')
	})

	test('returns lowercase extension', () => {
		expect(getFileExtension('https://example.com/IMAGE.PNG')).toBe('png')
	})

	test('defaults to png for URLs without extension', () => {
		expect(getFileExtension('https://example.com/image')).toBe('png')
	})

	test('defaults to png for invalid URLs', () => {
		expect(getFileExtension('not-a-valid-url')).toBe('png')
	})

	test('handles URLs with dots in path', () => {
		expect(getFileExtension('https://example.com/v1.2.3/image.webp')).toBe('webp')
	})
})

describe('extractFilenameFromUrl', () => {
	test('extracts filename from simple URL', () => {
		expect(extractFilenameFromUrl('https://example.com/photo.png')).toBe('photo')
	})

	test('extracts filename from nested path', () => {
		expect(extractFilenameFromUrl('https://example.com/uploads/2024/05/image.jpg')).toBe('image')
	})

	test('sanitizes special characters', () => {
		expect(extractFilenameFromUrl('https://example.com/my%20file@name!.png')).toBe('my-20file-name')
	})

	test('collapses multiple dashes', () => {
		expect(extractFilenameFromUrl('https://example.com/file---name.png')).toBe('file-name')
	})

	test('removes leading and trailing dashes', () => {
		expect(extractFilenameFromUrl('https://example.com/-filename-.png')).toBe('filename')
	})

	test('preserves underscores', () => {
		expect(extractFilenameFromUrl('https://example.com/my_file_name.png')).toBe('my_file_name')
	})

	test('defaults to "image" for empty result', () => {
		expect(extractFilenameFromUrl('https://example.com/---.png')).toBe('image')
	})

	test('defaults to "image" for invalid URL', () => {
		expect(extractFilenameFromUrl('not-a-url')).toBe('image')
	})

	test('handles Linear UUID-style filenames', () => {
		const result = extractFilenameFromUrl('https://uploads.linear.app/abc123-def456-ghi789')
		expect(result).toBe('abc123-def456-ghi789')
	})

	test('handles URL with no path segments', () => {
		expect(extractFilenameFromUrl('https://example.com/')).toBe('image')
	})
})

describe('getContentType', () => {
	test('returns correct MIME types for known extensions', () => {
		expect(getContentType('jpg')).toBe('image/jpeg')
		expect(getContentType('jpeg')).toBe('image/jpeg')
		expect(getContentType('png')).toBe('image/png')
		expect(getContentType('gif')).toBe('image/gif')
		expect(getContentType('webp')).toBe('image/webp')
		expect(getContentType('svg')).toBe('image/svg+xml')
		expect(getContentType('bmp')).toBe('image/bmp')
	})

	test('is case insensitive', () => {
		expect(getContentType('PNG')).toBe('image/png')
		expect(getContentType('JPG')).toBe('image/jpeg')
	})

	test('returns octet-stream for unknown extensions', () => {
		expect(getContentType('xyz')).toBe('application/octet-stream')
		expect(getContentType('unknown')).toBe('application/octet-stream')
	})
})
