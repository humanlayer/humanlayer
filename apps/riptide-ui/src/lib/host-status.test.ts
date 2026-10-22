import { HOST_DELETE_AFTER_MS } from '@humanlayer/riptide-api-contract/api/hosts/delete'
import { describe, expect, test } from 'vitest'

import { canDeleteHost, getHostStatus } from './host-status'

describe('host status and deletion eligibility', () => {
	const now = 2_000_000
	const cutoff = BigInt(now - HOST_DELETE_AFTER_MS)

	test.each([
		['offline', cutoff - 1n, true],
		['offline', cutoff, true],
		['offline', cutoff + 1n, false],
		['offline', BigInt(now + 1), false],
		['online', cutoff - 1n, false],
		['online', cutoff, false],
		['online', BigInt(now), false],
	] as const)('%s host at %s has eligibility %s', (status, last_seen, expected) => {
		expect(canDeleteHost({ status, last_seen }, now)).toBe(expected)
	})

	test('rendering an online host as stale does not make it deletable', () => {
		const host = { status: 'online' as const, last_seen: cutoff - 1n }
		expect(getHostStatus(host, now)).toBe('stale')
		expect(canDeleteHost(host, now)).toBe(false)
	})

	test('keeps the existing status boundary', () => {
		expect(getHostStatus({ status: 'offline', last_seen: BigInt(now) }, now)).toBe('offline')
		expect(getHostStatus({ status: 'online', last_seen: BigInt(now - 29_999) }, now)).toBe('online')
		expect(getHostStatus({ status: 'online', last_seen: BigInt(now - 30_000) }, now)).toBe('stale')
	})
})
