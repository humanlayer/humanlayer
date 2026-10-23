import { describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { makeFileDescriptorSnapshot } from '../../src/lib/effect/process-resource-metrics.service'

describe('makeFileDescriptorSnapshot', () => {
	it.effect('falls back to zero on non-Linux platforms', ({ expect }) =>
		Effect.gen(function* () {
			const snapshot = yield* makeFileDescriptorSnapshot({
				platform: 'darwin',
				readdir: async () => ['0', '1'],
				readFile: async () => 'Max open files            1024                 1024                 files',
			})

			expect(snapshot).toEqual({ open: 0 })
		}),
	)

	it.effect('parses Linux fd count and soft limit from proc files', ({ expect }) =>
		Effect.gen(function* () {
			const snapshot = yield* makeFileDescriptorSnapshot({
				platform: 'linux',
				readdir: async (path) => {
					expect(path).toBe('/proc/self/fd')
					return ['0', '1', '2', '3']
				},
				readFile: async (path) => {
					expect(path).toBe('/proc/self/limits')
					return 'Limit                     Soft Limit           Hard Limit           Units\nMax open files            65535                65535                files\n'
				},
			})

			expect(snapshot).toEqual({ open: 4, limit: 65_535, utilization: 4 / 65_535 })
		}),
	)

	it.effect('falls back safely when proc fd cannot be read', ({ expect }) =>
		Effect.gen(function* () {
			const snapshot = yield* makeFileDescriptorSnapshot({
				platform: 'linux',
				readdir: async () => {
					throw new Error('missing proc')
				},
				readFile: async () => '',
			})

			expect(snapshot).toEqual({ open: 0 })
		}),
	)
})
