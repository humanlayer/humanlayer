import { Effect, Layer, ManagedRuntime, Stream } from 'effect'
import { describe, expect, test, vi } from 'vitest'

import type { DaemonServices } from '@/agents/claudecode/types'
import { createDaemonRuntime, type DaemonRuntime } from '@/effects/runtime'
import { ClaudeExecutionError } from '@/effects/services/claude-sessions/claude-session-errors'
import { createClaudeSessionExecutor } from '@/effects/services/claude-sessions/claude-session-executor'
import { ClaudeSessions } from '@/effects/services/claude-sessions/claude-sessions.service'
import {
	DaemonCollections,
	type DaemonCollectionsService,
} from '@/effects/services/daemon-collections/daemon-collections.service'

import { makeBasicEffectSession, makeSessionContext } from '../fixtures/effect-claude-runtime'

function makeRuntime(executeClaudeSession: ClaudeSessions['Service']['executeClaudeSession']) {
	return ManagedRuntime.make(
		Layer.succeed(ClaudeSessions, {
			executeClaudeSession,
			deliverFollowUpMessage: () => Effect.succeed('not-active'),
			stopClaudeSession: () => Effect.succeed('not-active' as const),
			shutdownActiveClaudeSessions: Effect.void,
			activeSessionIds: Effect.succeed([]),
		}),
	)
}

const unavailableSyncService: DaemonServices['syncService'] = {
	ensureTaskSync: () => Promise.reject(new Error('Task sync is unavailable in this test')),
	shutdown: () => undefined,
	getDebugState: () => ({ activeTaskIds: [], registeredTaskIds: [], pendingTaskIds: [] }),
}

const testCollections: DaemonCollectionsService = {
	current: Effect.die('unused'),
	sessionChanges: Stream.empty,
	taskChanges: Stream.empty,
	approvalChanges: Stream.empty,
	workspaceSetupChanges: Stream.empty,
	providerLoginChanges: Stream.empty,
	workspaceSetups: Stream.empty,
	workspaceSetupSessions: Stream.empty,
	streamSessionChanges: () => Stream.empty,
	streamApprovalChanges: () => Stream.empty,
}

describe('Claude executor daemon-runtime adapter', () => {
	test('installs ClaudeSessions in the process-owned daemon runtime', async () => {
		const runtime = createDaemonRuntime({
			orpc: {} as DaemonServices['orpc'],
			daemonCollectionsLayer: Layer.succeed(DaemonCollections, testCollections),
			syncOrigin: 'http://sync.test',
			daemonToken: 'test-token',
			devMode: false,
			inheritedEnvironment: {},
			syncService: unavailableSyncService,
		})

		await runtime.runPromise(
			Effect.gen(function* () {
				const sessions = yield* ClaudeSessions
				return yield* sessions.shutdownActiveClaudeSessions
			}),
		)
		await runtime.dispose()
	})

	test('executes concurrent sessions through the installed ClaudeSessions service', async () => {
		const observedSessionIds: string[] = []
		const runtime = makeRuntime((input) =>
			Effect.sync(() => {
				observedSessionIds.push(input.context.session.id)
			}),
		)
		const execute = createClaudeSessionExecutor(runtime as unknown as DaemonRuntime)

		await Promise.all([
			execute(makeSessionContext(makeBasicEffectSession({ id: 'session-a' }))),
			execute(makeSessionContext(makeBasicEffectSession({ id: 'session-b' }))),
		])

		expect(observedSessionIds.sort()).toEqual(['session-a', 'session-b'])
		await runtime.dispose()
	})

	test('forwards resume and fork inputs without constructing another runtime', async () => {
		const observed = vi.fn()
		const runtime = makeRuntime((input) => Effect.sync(() => observed(input)))
		const execute = createClaudeSessionExecutor(runtime as unknown as DaemonRuntime)
		const context = makeSessionContext(makeBasicEffectSession({ id: 'resumed-session' }))
		const forkMeta = {
			agent: 'claude' as const,
			forkFromCodingAgentSessionId: 'fork-session',
			forkAtCodingAgentEventId: 'fork-event',
		}

		await execute(context, 'claude-session-id', forkMeta)

		expect(observed).toHaveBeenCalledWith({
			context,
			setupArtifactPaths: expect.any(Function),
			resumeSessionId: 'claude-session-id',
			forkMeta,
		})
		await runtime.dispose()
	})

	test('rejects the Promise boundary with the terminal failure', async () => {
		const error = new ClaudeExecutionError({
			sessionId: 'failed-session',
			cause: new Error('boom'),
			message: 'boom',
		})
		const runtime = makeRuntime(() => Effect.fail(error))
		const execute = createClaudeSessionExecutor(runtime as unknown as DaemonRuntime)
		const context = makeSessionContext(makeBasicEffectSession({ id: 'failed-session' }))

		await expect(execute(context)).rejects.toBe(error)

		await runtime.dispose()
	})
})
