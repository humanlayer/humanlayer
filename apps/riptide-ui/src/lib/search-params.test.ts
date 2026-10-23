import { describe, expect, test } from 'vitest'

import { optionalBooleanSearchParam } from './search-params'

describe('optionalBooleanSearchParam', () => {
	test.each([
		['true', true],
		['false', false],
		[true, true],
		[false, false],
		[undefined, undefined],
	])('parses %s as %s', (input, expected) => {
		expect(optionalBooleanSearchParam.parse(input)).toBe(expected)
	})

	test('rejects other string values', () => {
		expect(optionalBooleanSearchParam.safeParse('yes').success).toBe(false)
	})
})
