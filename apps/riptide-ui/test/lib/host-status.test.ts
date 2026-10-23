import { describe, expect, test } from 'vitest'

import { getHostStatus } from '@/lib/host-status'

const NOW = 1_800_000_000_000

describe('getHostStatus', () => {
	test('returns offline whenever the stored status is offline', () => {
		expect(getHostStatus({ status: 'offline', last_seen: BigInt(NOW) }, NOW)).toBe('offline')
		expect(getHostStatus({ status: 'offline', last_seen: BigInt(NOW - 60_000) }, NOW)).toBe('offline')
	})

	test('returns online before the 30-second boundary', () => {
		expect(getHostStatus({ status: 'online', last_seen: BigInt(NOW - 29_999) }, NOW)).toBe('online')
	})

	test('returns stale at and after the 30-second boundary', () => {
		expect(getHostStatus({ status: 'online', last_seen: BigInt(NOW - 30_000) }, NOW)).toBe('stale')
		expect(getHostStatus({ status: 'online', last_seen: BigInt(NOW - 60_000) }, NOW)).toBe('stale')
	})
})
