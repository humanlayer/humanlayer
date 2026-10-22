import { Effect } from 'effect'
import { describe, expect, test, vi } from 'vitest'

// `Effect.tryPromise` invokes its `try` callback with an `AbortSignal`. `materializeRpiPlugin`
// must call `ensureRpiPluginOnDisk()` with NO arguments, otherwise that signal is forwarded as the
// optional `baseDir` and `path.join(signal, …)` throws `TypeError: paths[0] … must be of type
// string`, failing every Effect-runtime Claude launch (see PR #1800 regression).
const { ensureRpiPluginOnDiskMock } = vi.hoisted(() => ({
	ensureRpiPluginOnDiskMock: vi.fn(() => Promise.resolve('/mock/rpi/plugin')),
}))

vi.mock('@/plugins/ensure-plugin', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/plugins/ensure-plugin')>()
	return { ...actual, ensureRpiPluginOnDisk: ensureRpiPluginOnDiskMock }
})

import { materializeRpiPlugin } from '@/effects/services/claude-sessions/claude-session-preparation-adapters'

describe('materializeRpiPlugin', () => {
	test('calls ensureRpiPluginOnDisk with no arguments (does not forward tryPromise AbortSignal as baseDir)', async () => {
		ensureRpiPluginOnDiskMock.mockClear()

		const pluginPath = await Effect.runPromise(materializeRpiPlugin())

		expect(pluginPath).toBe('/mock/rpi/plugin')
		expect(ensureRpiPluginOnDiskMock).toHaveBeenCalledTimes(1)
		// The bug forwarded the AbortSignal here; the fix passes nothing.
		expect(ensureRpiPluginOnDiskMock.mock.calls[0]).toHaveLength(0)
	})
})
