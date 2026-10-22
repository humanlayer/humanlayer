import { describe, expect, test } from 'vitest'

import { shouldRetryQuery } from './query-retry'

describe('shouldRetryQuery', () => {
	test.each([{ code: 'NOT_FOUND' }, { status: 404 }, { code: 'NOT_FOUND', status: 404 }])(
		'does not retry not-found errors',
		(error) => {
			expect(shouldRetryQuery(0, error)).toBe(false)
		},
	)

	test('retains the default retry count for other failures', () => {
		expect(shouldRetryQuery(0, { status: 500 })).toBe(true)
		expect(shouldRetryQuery(2, new Error('network failure'))).toBe(true)
		expect(shouldRetryQuery(3, { status: 500 })).toBe(false)
	})
})
