import { describe, expect, test } from 'vitest'

import { formatCompactDuration } from './format-duration'

describe('formatCompactDuration', () => {
	test.each([
		[0, '0s'],
		[4_000, '4s'],
		[59_999, '59s'],
		[60_000, '1m 00s'],
		[72_000, '1m 12s'],
		[600_000, '10m 00s'],
		[5_506_000, '1h 31m'],
		[6 * 3_600_000, '6h 00m'],
		[30 * 3_600_000 + 60_000, '30h 01m'],
	])('%i ms reads %s', (elapsedMs, expected) => {
		expect(formatCompactDuration(elapsedMs)).toBe(expected)
	})

	test('a negative interval reads as nothing elapsed', () => {
		expect(formatCompactDuration(-5_000)).toBe('0s')
	})
})
