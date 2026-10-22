import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import * as BunServices from '@effect/platform-bun/BunServices'
import { describe, it } from '@effect/vitest'
import { Deferred, Effect, Fiber, Layer, Queue, Stream } from 'effect'
import * as ConfigProvider from 'effect/ConfigProvider'
import { TestClock } from 'effect/testing'

import type { DaemonServices } from '@/agents/claudecode/types'
import { ClaudeProcessEnvironment } from '@/effects/services/claude-sessions/claude-process-environment'
import { makeClaudeSessionsLive } from '@/effects/services/claude-sessions/claude-sessions.live'
import { ClaudeSessions } from '@/effects/services/claude-sessions/claude-sessions.service'
import { ClaudeSdk } from '@/effects/services/claude-sessions/sdk/claude-sdk-session.service'
import { DaemonApi } from '@/effects/services/daemon-api/daemon-api.service'
import { DaemonCollections } from '@/effects/services/daemon-collections/daemon-collections.service'
import { DaemonTaskSync } from '@/effects/services/daemon-task-sync'
import { DurableStreamFetch } from '@/effects/services/stream-producer/durable-stream-fetch'
import { GitRunnerConfigurationLive } from '@/effects/services/task-diff/git-command-runner.layer'
import { TaskDiffServiceRegistry } from '@/effects/services/task-diff/task-diff-service-registry.service'
import { HostUsageLimitsLive } from '@/lib/usage-limits/host-usage-limits'

import { makeBasicEffectSession, makeSessionContext } from '../fixtures/effect-claude-runtime'
import { makeMockTaskWorkspaceContextLayer } from '../mocks/task-workspace-context.mock'

interface LifecycleControls {
	readonly events: Queue.Queue<SDKMessage>
	readonly closes: Queue.Queue<void>
	readonly sentPrompts: Queue.Queue<string>
	readonly readyForInput: Queue.Queue<void>
}

const resultEvent = { type: 'result', subtype: 'success' } as SDKMessage

function makeClaudeSessionsTestLayer(
	controls: LifecycleControls,
	closeSession: (sessionId: string) => Effect.Effect<void> = () =>
		Queue.offer(controls.closes, undefined).pipe(Effect.asVoid),
) {
	const collections = {
		sessions: { subscribeChanges: () => ({ unsubscribe: () => {} }) },
		approvals: { subscribeChanges: () => ({ unsubscribe: () => {} }) },
		tasks: { toArray: [] },
		workspaceSetup: { toArray: [] },
	} as unknown as DaemonServices['collections']
	const dependencies = Layer.mergeAll(
		GitRunnerConfigurationLive,
		HostUsageLimitsLive,
		Layer.succeed(
			ConfigProvider.ConfigProvider,
			ConfigProvider.fromUnknown({
				HOME: '/tmp',
				PATH: process.env.PATH ?? '',
				HUMANLAYER_CLAUDE_PATH: '/bin/echo',
				RIPTIDE_CLAUDE_SESSION_IDLE_TTL: '10 minutes',
				RIPTIDE_SYNC_ORIGIN: 'http://127.0.0.1:1',
			}),
		),
		Layer.succeed(DaemonApi, {
			updateProviderLogin: () => Effect.die('unused'),
			getWorkspaceRepositoryStatus: () => Effect.die('unused'),
			reportWorkspaceRepositoryResult: () => Effect.die('unused'),
			reportAgentCommands: () => Effect.die('unused'),
			getSessionWorkspaceSetup: () => Effect.die('unused'),
			getTaskWorkspaceContext: () => Effect.die('unused'),
			getSettings: () =>
				Effect.succeed({
					experimentalSubagentsEnabled: false,
					claudeCodeEffectRuntimeEnabled: false,
					haikuResearchSubagentsEnabled: false,
					jiraEnabled: false,
					linearEnabled: false,
					commitTrackingEnabled: false,
					prTrackingEnabled: false,
				}),
			listEnabledContextShards: () => Effect.succeed({ data: [] }),
			updateSession: (input) =>
				(input.status === 'ready_for_input'
					? Queue.offer(controls.readyForInput, undefined)
					: Effect.void
				).pipe(Effect.as({ success: true, transactionId: 'update-1' })),
			createConversationEvent: () => Effect.die('unused'),
			recordUsage: () => Effect.succeed({ recorded: 0 }),
			ensureConversationStream: (input) =>
				Effect.succeed({ sessionId: input.sessionId, status: 'exists' as const }),
			createApproval: () => Effect.die('unused'),
			appendFoldSessionEvent: () => Effect.die('unused'),
			listFoldSessionEvents: () => Effect.die('unused'),
			getArtifactComments: () => Effect.die('unused'),
			updateArtifactComments: () => Effect.die('unused'),
			replyToArtifactComment: () => Effect.die('unused'),
			getDiffComments: () => Effect.die('unused'),
			updateDiffComments: () => Effect.die('unused'),
			replyToDiffComment: () => Effect.die('unused'),
			researchLibrary: () => Effect.die('unused'),
			createLinearAttachment: () => Effect.die('unused'),
			createJiraRemoteLink: () => Effect.die('unused'),
			syncGitHubArtifactBacklink: () => Effect.die('unused'),
			updateWorkspaceSetup: () => Effect.die('unused'),
		}),
		makeMockTaskWorkspaceContextLayer(),
		Layer.succeed(DaemonCollections, {
			current: Effect.succeed(collections),
			sessionChanges: Stream.never,
			taskChanges: Stream.never,
			approvalChanges: Stream.never,
			workspaceSetupChanges: Stream.never,
			providerLoginChanges: Stream.never,
			workspaceSetups: Stream.never,
			workspaceSetupSessions: Stream.never,
			streamSessionChanges: () => Stream.never,
			streamApprovalChanges: () => Stream.never,
		}),
		Layer.succeed(DaemonTaskSync, { ensureTaskSync: () => Effect.die('unused') }),
		Layer.succeed(TaskDiffServiceRegistry, {
			requestCapture: () => Effect.die('unused'),
			registerWorkspace: () => Effect.die('unused'),
			suspendWorkspace: () => Effect.die('unused'),
			resumeWorkspace: () => Effect.die('unused'),
			drain: Effect.void,
		}),
		Layer.succeed(ClaudeProcessEnvironment, process.env),
		Layer.succeed(DurableStreamFetch, { fetch }),
	).pipe(Layer.provideMerge(BunServices.layer))
	const sdk = Layer.succeed(ClaudeSdk, {
		open: (input) =>
			Effect.succeed({
				output: Stream.never,
				input: {
					sendMessage: (prompt: string) => Queue.offer(controls.sentPrompts, prompt).pipe(Effect.asVoid),
					close: closeSession(input.sessionId),
				},
				controls: {
					interrupt: Effect.void,
					setModel: () => Effect.void,
					setPermissionMode: () => Effect.void,
					supportedCommands: Effect.succeed([]),
					readUsage: Effect.succeed(undefined),
				},
				markCompleted: Effect.void,
			}),
	})
	const processOpenSession: Parameters<typeof makeClaudeSessionsLive>[0] = (input) => {
		const completeResult = (input.onResult ?? Effect.void).pipe(
			Effect.andThen(Queue.offer(controls.readyForInput, undefined)),
		)
		return completeResult.pipe(
			Effect.andThen(Stream.fromQueue(controls.events).pipe(Stream.runForEach(() => completeResult))),
		)
	}
	return makeClaudeSessionsLive(processOpenSession).pipe(Layer.provideMerge(sdk), Layer.provideMerge(dependencies))
}

const makeControls = Effect.gen(function* () {
	return {
		events: yield* Queue.unbounded<SDKMessage>(),
		closes: yield* Queue.unbounded<void>(),
		sentPrompts: yield* Queue.unbounded<string>(),
		readyForInput: yield* Queue.unbounded<void>(),
	}
})

describe('ClaudeSessionsLive lifecycle', () => {
	it.effect('closes the actual SDK resource when the completed session reaches its idle TTL', ({ expect }) =>
		Effect.gen(function* () {
			const controls = yield* makeControls
			const session = makeBasicEffectSession()
			yield* Effect.gen(function* () {
				const sessions = yield* ClaudeSessions
				yield* sessions.executeClaudeSession({
					context: makeSessionContext(session),
					setupArtifactPaths: () => Promise.reject('unused'),
				})
				yield* Queue.take(controls.readyForInput)
				yield* TestClock.adjust('10 minutes')
				yield* Queue.take(controls.closes)
				expect(yield* Queue.size(controls.closes)).toBe(0)
				expect(yield* sessions.stopClaudeSession({ sessionId: session.id })).toBe('not-active')
			}).pipe(Effect.provide(makeClaudeSessionsTestLayer(controls)), Effect.scoped)
		}),
	)

	it.effect('lists sessions idle between turns as active until they stop or reach the idle TTL', ({ expect }) =>
		Effect.gen(function* () {
			const controls = yield* makeControls
			const first = makeBasicEffectSession()
			const second = makeBasicEffectSession({ id: 'effect-session-2' })
			yield* Effect.gen(function* () {
				const sessions = yield* ClaudeSessions
				expect(yield* sessions.activeSessionIds).toEqual([])
				for (const session of [first, second]) {
					yield* sessions.executeClaudeSession({
						context: makeSessionContext(session),
						setupArtifactPaths: () => Promise.reject('unused'),
					})
					yield* Queue.take(controls.readyForInput)
				}
				expect(yield* sessions.activeSessionIds).toEqual([first.id, second.id])

				expect(yield* sessions.stopClaudeSession({ sessionId: second.id })).toBe('stopped')
				expect(yield* sessions.activeSessionIds).toEqual([first.id])

				yield* TestClock.adjust('10 minutes')
				yield* Queue.take(controls.closes)
				yield* Queue.take(controls.closes)
				expect(yield* sessions.activeSessionIds).toEqual([])
			}).pipe(Effect.provide(makeClaudeSessionsTestLayer(controls)), Effect.scoped)
		}),
	)

	it.effect('closes on explicit stop and cancels then rearms idle cleanup around a follow-up', ({ expect }) =>
		Effect.gen(function* () {
			const controls = yield* makeControls
			const session = makeBasicEffectSession()
			yield* Effect.gen(function* () {
				const sessions = yield* ClaudeSessions
				yield* sessions.executeClaudeSession({
					context: makeSessionContext(session),
					setupArtifactPaths: () => Promise.reject('unused'),
				})
				yield* Queue.take(controls.readyForInput)
				yield* TestClock.adjust('9 minutes')
				expect(yield* sessions.deliverFollowUpMessage({ sessionId: session.id, prompt: 'again' })).toBe(
					'accepted',
				)
				expect(yield* Queue.take(controls.sentPrompts)).toBe('again')
				yield* TestClock.adjust('2 minutes')
				expect(yield* Queue.size(controls.closes)).toBe(0)
				yield* Queue.offer(controls.events, resultEvent)
				yield* Queue.take(controls.readyForInput)
				yield* TestClock.adjust('10 minutes')
				yield* Queue.take(controls.closes)

				const second = makeBasicEffectSession({ id: 'effect-session-2' })
				yield* sessions.executeClaudeSession({
					context: makeSessionContext(second),
					setupArtifactPaths: () => Promise.reject('unused'),
				})
				expect(yield* sessions.stopClaudeSession({ sessionId: second.id })).toBe('stopped')
				yield* Queue.take(controls.closes)
			}).pipe(Effect.provide(makeClaudeSessionsTestLayer(controls)), Effect.scoped)
		}),
	)

	it.effect('releases lifecycle admission when a Claude run fiber cannot finish cleanup', ({ expect }) =>
		Effect.gen(function* () {
			const controls = yield* makeControls
			const stuckCloseRelease = yield* Deferred.make<void>()
			const first = makeBasicEffectSession({ id: 'stuck-session' })
			const second = makeBasicEffectSession({ id: 'replacement-session' })
			const closeSession = (sessionId: string) =>
				sessionId === first.id
					? Deferred.await(stuckCloseRelease)
					: Queue.offer(controls.closes, undefined).pipe(Effect.asVoid)

			yield* Effect.gen(function* () {
				const sessions = yield* ClaudeSessions
				yield* sessions.executeClaudeSession({
					context: makeSessionContext(first),
					setupArtifactPaths: () => Promise.reject('unused'),
				})
				yield* Queue.take(controls.readyForInput)
				const stopFiber = yield* sessions.stopClaudeSession({ sessionId: first.id }).pipe(Effect.forkChild)
				yield* Effect.yieldNow
				yield* TestClock.adjust('15 seconds')
				expect(yield* Fiber.join(stopFiber)).toBe('timed-out')

				yield* sessions.executeClaudeSession({
					context: makeSessionContext(second),
					setupArtifactPaths: () => Promise.reject('unused'),
				})
				yield* Queue.take(controls.readyForInput)
				expect(yield* sessions.stopClaudeSession({ sessionId: second.id })).toBe('stopped')
				yield* Queue.take(controls.closes)
				yield* Deferred.succeed(stuckCloseRelease, undefined)
			}).pipe(Effect.provide(makeClaudeSessionsTestLayer(controls, closeSession)), Effect.scoped)
		}),
	)
})
