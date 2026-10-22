import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import * as BunServices from '@effect/platform-bun/BunServices'
import { it } from '@effect/vitest'
import { Effect, Layer, Stream } from 'effect'
import * as ConfigProvider from 'effect/ConfigProvider'
import { afterAll, beforeAll, expect } from 'vitest'

import type { DaemonServices } from '@/agents/claudecode/types'
import { ClaudeProcessEnvironment } from '@/effects/services/claude-sessions/claude-process-environment'
import { ClaudeSessionsLive } from '@/effects/services/claude-sessions/claude-sessions.live'
import { ClaudeSessions } from '@/effects/services/claude-sessions/claude-sessions.service'
import { ClaudeSdkLive } from '@/effects/services/claude-sessions/sdk/claude-sdk-session.layer'
import { DaemonApi } from '@/effects/services/daemon-api/daemon-api.service'
import { DaemonCollections } from '@/effects/services/daemon-collections/daemon-collections.service'
import { DaemonTaskSync } from '@/effects/services/daemon-task-sync'
import { DurableStreamFetchLive } from '@/effects/services/stream-producer/durable-stream-fetch'
import { GitRunnerConfigurationLive } from '@/effects/services/task-diff/git-command-runner.layer'
import { TaskDiffServiceRegistry } from '@/effects/services/task-diff/task-diff-service-registry.service'
import { HostUsageLimitsLive } from '@/lib/usage-limits/host-usage-limits'

import { makeSessionContext } from '../fixtures/effect-claude-runtime'
import { describeRealClaude } from '../helpers/real-claude'
import { createTestSession } from '../helpers/session-fixtures'
import { makeMockTaskWorkspaceContextLayer } from '../mocks/task-workspace-context.mock'

describeRealClaude('Session Runner - Real SDK Integration', () => {
	let tempDirectory: string

	beforeAll(async () => {
		tempDirectory = await mkdtemp(join(tmpdir(), 'effect-claude-session-runner-'))
	})

	afterAll(async () => {
		await rm(tempDirectory, { recursive: true, force: true })
	})

	it.effect(
		'persists init, assistant output, and completion in SDK event order',
		() => {
			const callOrder: string[] = []
			const sessionUpdates: Array<Record<string, unknown>> = []
			const conversationEvents: Array<Record<string, unknown>> = []
			const session = createTestSession({
				working_directory: tempDirectory,
				prompt: 'Do not use tools. Reply with exactly: EFFECT_REAL_CLAUDE_OK',
				permissions_mode: 'bypass',
			})
			const collections = {
				sessions: { subscribeChanges: () => ({ unsubscribe: () => {} }) },
				approvals: { subscribeChanges: () => ({ unsubscribe: () => {} }) },
				tasks: { toArray: [] },
				workspaceSetup: { toArray: [] },
			} as unknown as DaemonServices['collections']

			const TestConfig = Layer.succeed(
				ConfigProvider.ConfigProvider,
				ConfigProvider.orElse(
					ConfigProvider.fromUnknown({
						RIPTIDE_SYNC_ORIGIN: 'http://127.0.0.1:1',
						RIPTIDE_DAEMON_TOKEN: 'real-claude-test-token',
					}),
					ConfigProvider.fromEnv(),
				),
			)
			const TestApi = Layer.succeed(DaemonApi, {
				updateProviderLogin: () => Effect.die('unused updateProviderLogin'),
				getWorkspaceRepositoryStatus: () => Effect.die('unused getWorkspaceRepositoryStatus'),
				reportWorkspaceRepositoryResult: () => Effect.die('unused reportWorkspaceRepositoryResult'),
				getSessionWorkspaceSetup: () => Effect.die('unused getSessionWorkspaceSetup'),
				getTaskWorkspaceContext: () => Effect.die('unused getTaskWorkspaceContext'),
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
					Effect.sync(() => {
						sessionUpdates.push(input)
						callOrder.push(`update:${input.status ?? 'unchanged'}`)
						return { success: true, transactionId: `update-${sessionUpdates.length}` }
					}),
				createConversationEvent: (input) =>
					Effect.sync(() => {
						conversationEvents.push(input)
						callOrder.push('event:create')
						return {
							eventId: `event-${conversationEvents.length}`,
							transactionId: `event-transaction-${conversationEvents.length}`,
						}
					}),
				recordUsage: () => Effect.succeed({ recorded: 1 }),
				ensureConversationStream: () => Effect.succeed({ sessionId: session.id, status: 'exists' as const }),
				reportAgentCommands: () => Effect.succeed({ updated: true }),
				createApproval: () => Effect.die('Claude unexpectedly requested approval'),
				appendFoldSessionEvent: () => Effect.die('Claude unexpectedly appended a Fold event'),
				listFoldSessionEvents: () => Effect.die('Claude unexpectedly listed Fold events'),
				getArtifactComments: () => Effect.die('Claude unexpectedly read artifact comments'),
				updateArtifactComments: () => Effect.die('Claude unexpectedly updated artifact comments'),
				replyToArtifactComment: () => Effect.die('Claude unexpectedly replied to an artifact comment'),
				getDiffComments: () => Effect.die('Claude unexpectedly read diff comments'),
				updateDiffComments: () => Effect.die('Claude unexpectedly updated diff comments'),
				replyToDiffComment: () => Effect.die('Claude unexpectedly replied to a diff comment'),
				researchLibrary: () => Effect.die('Claude unexpectedly requested library research'),
				createLinearAttachment: () => Effect.die('Claude unexpectedly created a Linear attachment'),
				createJiraRemoteLink: () => Effect.die('Claude unexpectedly created a Jira link'),
				syncGitHubArtifactBacklink: () => Effect.die('Claude unexpectedly synchronized a GitHub backlink'),
				updateWorkspaceSetup: () => Effect.die('Claude unexpectedly updated workspace setup'),
			})
			const TestDependencies = Layer.mergeAll(
				GitRunnerConfigurationLive,
				HostUsageLimitsLive,
				TestConfig,
				TestApi,
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
				Layer.succeed(DaemonTaskSync, {
					ensureTaskSync: () => Effect.die('A taskless test session unexpectedly requested task sync'),
				}),
				DurableStreamFetchLive,
				Layer.succeed(TaskDiffServiceRegistry, {
					requestCapture: () => Effect.die('A taskless test session unexpectedly requested diff capture'),
					registerWorkspace: () => Effect.die('A taskless test session unexpectedly registered a workspace'),
					suspendWorkspace: () => Effect.die('A taskless test session unexpectedly suspended a workspace'),
					resumeWorkspace: () => Effect.die('A taskless test session unexpectedly resumed a workspace'),
					drain: Effect.void,
				}),
				Layer.succeed(ClaudeProcessEnvironment, process.env),
			).pipe(Layer.provideMerge(BunServices.layer))
			const ClaudeAdapters = ClaudeSdkLive.pipe(Layer.provideMerge(TestDependencies))
			const TestClaudeSessions = ClaudeSessionsLive.pipe(
				Layer.provideMerge(ClaudeAdapters),
				Layer.provideMerge(TestDependencies),
			)

			return Effect.gen(function* () {
				const claudeSessions = yield* ClaudeSessions
				yield* claudeSessions.executeClaudeSession({
					context: makeSessionContext(session),
					setupArtifactPaths: () =>
						Effect.runPromise(Effect.die('Taskless session requested artifact setup')),
				})
				while (!sessionUpdates.some((update) => update.status === 'ready_for_input')) {
					yield* Effect.sleep('50 millis')
				}

				const followUpOutcome = yield* claudeSessions.deliverFollowUpMessage({
					sessionId: session.id,
					prompt: 'Do not use tools. Reply with exactly: EFFECT_REAL_CLAUDE_FOLLOW_UP_OK',
				})
				while (sessionUpdates.filter((update) => update.status === 'ready_for_input').length < 2) {
					yield* Effect.sleep('50 millis')
				}
				yield* claudeSessions.shutdownActiveClaudeSessions

				const runningUpdate = sessionUpdates.find(
					(update) => update.status === 'running' && typeof update.codingAgentSessionId === 'string',
				)
				const assistantEvents = conversationEvents.filter(
					(event) => event.eventType === 'message' && event.role === 'assistant',
				)
				const readyUpdate = sessionUpdates.find((update) => update.status === 'ready_for_input')
				const runningIndex = callOrder.indexOf('update:running')
				const firstEventIndex = callOrder.indexOf('event:create')

				expect(runningUpdate).toBeDefined()
				expect(followUpOutcome).toBe('accepted')
				expect(assistantEvents.length).toBeGreaterThanOrEqual(1)
				expect(readyUpdate).toBeDefined()
				expect(sessionUpdates.some((update) => update.status === 'failed')).toBe(false)
				expect(runningIndex).toBeGreaterThanOrEqual(0)
				expect(firstEventIndex).toBeGreaterThanOrEqual(0)
				expect(runningIndex).toBeLessThan(firstEventIndex)
			}).pipe(Effect.provide(TestClaudeSessions))
		},
		120_000,
	)
})
