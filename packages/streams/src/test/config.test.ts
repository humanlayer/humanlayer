import { describe, expect, it } from 'vitest'

import { DURABLE_STREAM_CREATE_BACKOFF_OPTIONS, DURABLE_STREAM_READ_BACKOFF_OPTIONS } from '../config'

describe('durable stream backoff configuration', () => {
	it('backs long-lived readers off to a twenty-second ceiling', () => {
		expect(DURABLE_STREAM_READ_BACKOFF_OPTIONS).toEqual({
			initialDelay: 250,
			maxDelay: 20_000,
			multiplier: 2,
			maxRetries: Infinity,
		})
	})

	it('backs stream creation off to a sixty-second ceiling', () => {
		expect(DURABLE_STREAM_CREATE_BACKOFF_OPTIONS).toEqual({
			initialDelay: 500,
			maxDelay: 60_000,
			multiplier: 2,
			maxRetries: Infinity,
		})
	})
})
