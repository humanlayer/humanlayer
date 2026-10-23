import * as BunServices from '@effect/platform-bun/BunServices'
import { ActorSystemDefault } from '@humanlayer/effect-machine'
import { Effect, Layer, ManagedRuntime } from 'effect'

import { ShutdownCoordinator } from '../../src/agents/claudecode/shutdown'
import type { DaemonServices } from '../../src/agents/claudecode/types'
import type { DaemonRuntime } from '../../src/effects/runtime'
import { ClaudeSessions } from '../../src/effects/services/claude-sessions/claude-sessions.service'
import { DaemonApiLive } from '../../src/effects/services/daemon-api/daemon-api.layer'
import { DaemonCollectionsLive } from '../../src/effects/services/daemon-collections/daemon-collections.layer'
import { SessionRunRegistryLive } from '../../src/effects/services/session-runs/session-run-registry'
import {
	GitCommandRunnerLive,
	GitRunnerConfigurationLive,
} from '../../src/effects/services/task-diff/git-command-runner.layer'
import { TaskDiffLifecycleObserver } from '../../src/effects/services/task-diff/task-diff-lifecycle-observer.service'
import { WorkspaceSessionLaunchActorsLive } from '../../src/effects/services/workspace-session-launch/workspace-session-launch-actors.layer'

/**
 * Stands in for a service the caller is expected to supply. Reaching for one of its methods
 * means a code path grew a dependency the test never declared, so it fails loudly and names
 * the seam rather than surfacing later as `undefined is not a function`.
 */
const failFastCapability = <T extends object>(name: string): T =>
	new Proxy(Object.create(null) as object, {
		get: (_target, property) => {
			throw new Error(`Mock ${name}.${String(property)} was used without an explicit override`)
		},
	}) as T

const createDefaultCollections = (): DaemonServices['collections'] => ({
	sessions: {
		get: () => undefined,
		subscribeChanges: () => ({ unsubscribe: () => {} }),
	} as unknown as DaemonServices['collections']['sessions'],
	approvals: {
		get: () => undefined,
		state: { get: () => undefined },
		subscribeChanges: () => ({ unsubscribe: () => {} }),
	} as unknown as DaemonServices['collections']['approvals'],
	tasks: { toArray: [] } as unknown as DaemonServices['collections']['tasks'],
	workspaceSetup: { toArray: [] } as unknown as DaemonServices['collections']['workspaceSetup'],
	providerLoginRequests: { toArray: [] } as unknown as DaemonServices['collections']['providerLoginRequests'],
})

/**
 * Canonical daemon test service bag. Tests override only the seams they exercise, so adding a
 * service to `DaemonServices` means updating one default here rather than every daemon test.
 *
 * `daemonRuntime` is a real runtime rather than a fail-fast stub: nothing reads it yet, but it is
 * the seam the task-diff services land on, and a stub would turn the first read into a test-wide
 * failure. `orpc` and `syncService` fail fast because every test that reaches them supplies its
 * own recording mock, and an inert default would silently swallow the calls they assert on.
 */
export function createMockDaemonServices(overrides: Partial<DaemonServices> = {}): DaemonServices {
	const orpc = overrides.orpc ?? failFastCapability<DaemonServices['orpc']>('orpc')
	const collections = overrides.collections ?? createDefaultCollections()
	// Subscriptions route V2 sessions through the launch actors, which call the API through the
	// test's `orpc` mock and hand off through the WorkspaceSessionRunner initializeSubscriptions provides.
	const WorkspaceSessionLaunchLive = WorkspaceSessionLaunchActorsLive.pipe(
		Layer.provideMerge(Layer.mergeAll(ActorSystemDefault, DaemonApiLive(orpc))),
	)

	return {
		daemonRuntime:
			overrides.daemonRuntime ??
			(ManagedRuntime.make(
				Layer.mergeAll(
					Layer.succeed(ClaudeSessions, {
						executeClaudeSession: () =>
							Effect.die('Mock ClaudeSessions.executeClaudeSession was not configured'),
						deliverFollowUpMessage: () => Effect.succeed('not-active'),
						stopClaudeSession: () => Effect.succeed('not-active' as const),
						shutdownActiveClaudeSessions: Effect.void,
						activeSessionIds: Effect.succeed([]),
					}),
					Layer.succeed(TaskDiffLifecycleObserver, {
						initialize: () => Effect.void,
						observeTask: () => Effect.void,
						observeWorkspace: () => Effect.void,
					}),
					DaemonCollectionsLive(collections),
					GitCommandRunnerLive,
					GitRunnerConfigurationLive.pipe(Layer.orDie),
					WorkspaceSessionLaunchLive,
					SessionRunRegistryLive,
				).pipe(Layer.provideMerge(BunServices.layer)),
			) as unknown as DaemonRuntime),
		orpc,
		collections,
		shutdown: new ShutdownCoordinator(),
		syncService: failFastCapability<DaemonServices['syncService']>('syncService'),
		executors: {
			claude: async () => {
				throw new Error('Mock executors.claude was used without an explicit override')
			},
			codelayer: async () => {
				throw new Error('Mock executors.codelayer was used without an explicit override')
			},
			fold: async () => {
				throw new Error('Mock executors.fold was used without an explicit override')
			},
		},
		...overrides,
	}
}
