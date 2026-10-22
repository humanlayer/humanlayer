import { describe, expect, test } from 'vitest'

import { cleanupExpiredCodelayerForkSnapshots } from '../index'

describe('cleanupExpiredCodelayerForkSnapshots', () => {
	test('loops over bounded batches until no rows remain', async () => {
		const batches = [250, 125, 0]
		const sleeps: number[] = []

		const result = await cleanupExpiredCodelayerForkSnapshots({} as never, {
			now: 1_000_000,
			expiresBefore: 500_000,
			tombstoneBatch: async () => ({ rows: batches.shift() ?? 0, approxBytesFreed: 100 }),
			sleep: async (ms) => {
				sleeps.push(ms)
			},
		})

		expect(result.tombstonedRows).toBe(375)
		expect(result.approxBytesFreed).toBe(200)
		expect(result.batches).toBe(2)
		expect(result.stoppedReason).toBe('no_eligible_rows')
		expect(sleeps).toEqual([250, 250])
	})

	test('stops before another batch when Lambda time budget is low', async () => {
		const result = await cleanupExpiredCodelayerForkSnapshots({} as never, {
			getRemainingTimeInMillis: () => 10_000,
			tombstoneBatch: async () => {
				throw new Error('should not run batch')
			},
		})

		expect(result.tombstonedRows).toBe(0)
		expect(result.approxBytesFreed).toBe(0)
		expect(result.batches).toBe(0)
		expect(result.stoppedReason).toBe('time_budget')
	})

	test('stops at the configured max batch count', async () => {
		let calls = 0

		const result = await cleanupExpiredCodelayerForkSnapshots({} as never, {
			tombstoneBatch: async () => {
				calls += 1
				return { rows: 1, approxBytesFreed: 10 }
			},
			sleep: async () => {},
		})

		expect(calls).toBe(25)
		expect(result.tombstonedRows).toBe(25)
		expect(result.approxBytesFreed).toBe(250)
		expect(result.batches).toBe(25)
		expect(result.stoppedReason).toBe('max_batches')
	})
})
