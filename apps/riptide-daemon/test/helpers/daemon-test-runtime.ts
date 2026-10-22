import type { DaemonServices } from '../../src/agents/claudecode/types'
import { createDaemonRuntime, type DaemonRuntime } from '../../src/effects/runtime'

const unavailableSyncService: DaemonServices['syncService'] = {
	ensureTaskSync: () => Promise.reject(new Error('Task sync is unavailable in this test')),
	shutdown: () => undefined,
	getDebugState: () => ({ activeTaskIds: [], registeredTaskIds: [], pendingTaskIds: [] }),
}

/**
 * A real, bootable runtime for tests that need the `daemonRuntime` seam to exist. `ManagedRuntime`
 * builds its layer lazily, and omitting the production file logger keeps tests from writing logs.
 */
export const createDaemonTestRuntime = (
	orpc: DaemonServices['orpc'],
	collections: DaemonServices['collections'],
): DaemonRuntime => {
	return createDaemonRuntime({
		orpc,
		collections,
		syncOrigin: 'http://sync.test',
		daemonToken: 'test-token',
		devMode: false,
		inheritedEnvironment: {},
		syncService: unavailableSyncService,
	})
}
