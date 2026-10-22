import { describe, expect, it } from 'vitest'

import { serviceTestConcurrency } from './service-test-concurrency'

describe('serviceTestConcurrency', () => {
	it('defaults to the proven production limit', () => {
		expect(serviceTestConcurrency(undefined)).toBe(3)
	})
	it.each(['1', '3', '4', '6'])('accepts %s', (value) => {
		expect(serviceTestConcurrency(value)).toBe(Number(value))
	})
	it.each(['', '0', '7', '-1', '3.5', '03', ' 3', 'NaN', 'Infinity'])('rejects %s', (value) => {
		expect(() => serviceTestConcurrency(value)).toThrow('SERVICE_TEST_CONCURRENCY')
	})
})
