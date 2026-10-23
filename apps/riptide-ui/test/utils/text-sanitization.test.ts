import { describe, expect, test } from 'vitest'

import { sanitizeMessageText } from '../../src/utils/text-sanitization'

describe('sanitizeMessageText', () => {
	test('replaces non-breaking spaces with regular spaces', () => {
		const input = 'hello\u00A0world'
		expect(sanitizeMessageText(input)).toBe('hello world')
	})

	test('handles multiple non-breaking spaces', () => {
		const input = 'a\u00A0b\u00A0c'
		expect(sanitizeMessageText(input)).toBe('a b c')
	})

	test('preserves regular spaces', () => {
		const input = 'hello world'
		expect(sanitizeMessageText(input)).toBe('hello world')
	})

	test('handles empty string', () => {
		expect(sanitizeMessageText('')).toBe('')
	})
})
