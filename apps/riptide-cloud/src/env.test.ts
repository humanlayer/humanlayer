import { describe, expect, test } from 'vitest'

import { parsePublicEnvironment, PUBLIC_ENVIRONMENTS } from './env'

describe('parsePublicEnvironment', () => {
	test.each(PUBLIC_ENVIRONMENTS)('accepts %s', (environment) => {
		expect(parsePublicEnvironment(environment)).toBe(environment)
	})

	test.each([undefined, null, '', 'production', 42])('falls back to prod for %j', (value) => {
		expect(parsePublicEnvironment(value)).toBe('prod')
	})
})
