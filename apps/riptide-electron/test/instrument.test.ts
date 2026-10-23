import { describe, expect, test } from 'vitest'

import { isSentryEnabled } from '../src/instrument'

describe('isSentryEnabled', () => {
	test('stays off without a DSN, even when forced', () => {
		expect(isSentryEnabled({ dsn: undefined, environment: 'prod', forceEnable: false })).toBe(false)
		expect(isSentryEnabled({ dsn: undefined, environment: 'local', forceEnable: true })).toBe(false)
	})

	test('turns on with a DSN outside local', () => {
		expect(isSentryEnabled({ dsn: 'https://key@sentry.example/1', environment: 'prod', forceEnable: false })).toBe(
			true,
		)
		expect(isSentryEnabled({ dsn: 'https://key@sentry.example/1', environment: 'local', forceEnable: false })).toBe(
			false,
		)
	})
})
