import { describe, expect, test } from 'vitest'

import { extractImageUrls, isLinearUploadUrl } from './images'

describe('isLinearUploadUrl', () => {
	test('accepts https URLs whose host is exactly uploads.linear.app', () => {
		expect(isLinearUploadUrl('https://uploads.linear.app/abc/image.png')).toBe(true)
	})

	test('rejects look-alike hosts and URLs that merely contain the text', () => {
		expect(isLinearUploadUrl('https://uploads.linear.app.evil.com/image.png')).toBe(false)
		expect(isLinearUploadUrl('https://evil.com/uploads.linear.app/image.png')).toBe(false)
		expect(isLinearUploadUrl('https://evil.com/?next=uploads.linear.app')).toBe(false)
		expect(isLinearUploadUrl('https://uploads.linear.app@evil.com/image.png')).toBe(false)
		expect(isLinearUploadUrl('http://uploads.linear.app/image.png')).toBe(false)
		expect(isLinearUploadUrl('not a url')).toBe(false)
	})
})

describe('extractImageUrls', () => {
	test('extracts Linear uploads without an extension', () => {
		expect(extractImageUrls('![shot](https://uploads.linear.app/abc/file)')).toEqual([
			{ url: 'https://uploads.linear.app/abc/file', altText: 'shot' },
		])
	})

	test('does not treat a look-alike host as a Linear upload', () => {
		expect(extractImageUrls('![x](https://uploads.linear.app.evil.com/file)')).toEqual([])
	})
})
