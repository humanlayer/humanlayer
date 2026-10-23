import { randomUUID } from 'node:crypto'

import { NodeServices } from '@effect/platform-node'
import { describe, it } from '@effect/vitest'
import { conversationEvents } from '@humanlayer/db/tables/conversation-events'
import { foldSessionEvents } from '@humanlayer/db/tables/fold-session-events'
import { onlineHosts } from '@humanlayer/db/tables/online-hosts'
import { organizations } from '@humanlayer/db/tables/organizations'
import { sessions } from '@humanlayer/db/tables/sessions'
import {
	customModel,
	defineAgent,
	eventLogSource,
	EventLogUnsupportedVersionError,
	layerLiveIdFactory,
	resumeSession,
	SessionId,
	startSession,
} from '@humanlayer/fold-core'
import { createORPCClient, type ClientLink } from '@orpc/client'
import { call } from '@orpc/server'
import { and, asc, eq } from 'drizzle-orm'
import { Clock, Deferred, Effect, Fiber, Layer, Predicate, Ref, Schema, Stream } from 'effect'
import { LanguageModel, type Prompt, type Response } from 'effect/ai'
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, expect } from 'vitest'

import type { DaemonServices } from '@/agents/claudecode/types'
import { DaemonApiLive } from '@/effects/services/daemon-api/daemon-api.layer'
import { DaemonCollections } from '@/effects/services/daemon-collections/daemon-collections.service'
import { DaemonTaskSync } from '@/effects/services/daemon-task-sync'
import {
	decodePersistedFoldEntry,
	makeFoldEventLogSession,
} from '@/effects/services/fold-event-log/fold-event-log-session'
import { FoldSessionOpenerLive } from '@/effects/services/fold-sessions/fold-session-opener.layer'
import { FoldSessionOpener } from '@/effects/services/fold-sessions/fold-session-opener.service'
import { TaskDiffServiceRegistry } from '@/effects/services/task-diff/task-diff-service-registry.service'
import { ConfiguredRepoContext } from '@/lib/configured-repos/service'
import type { ORPCClient } from '@/orpc/client'

import { forkSessionV2Procedure } from '../../../riptide-api/src/orpc/api/sessions/fork'
import { appendFoldSessionEventProcedure as liveAppendFoldSessionEventProcedure } from '../../../riptide-api/src/orpc/daemon/fold-session-events/append.effect'
import { listFoldSessionEventsProcedure as liveListFoldSessionEventsProcedure } from '../../../riptide-api/src/orpc/daemon/fold-session-events/list.effect'
import {
	createMockApiAuth,
	createMockApiContext,
	createMockDaemonAuth,
	createMockDaemonContext,
} from '../../../riptide-api/test/mocks'
import {
	bindProcedureToRuntime,
	createRuntimeWithTestPostgresLayer,
} from '../../../riptide-api/test/utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../../../riptide-api/test/utils/external-test-services'
import { createTestDb } from '../../../riptide-api/test/utils/test-db'

await requireExternalTestServices()

const userId = 'user_fold_event_log_boundary'
const hostId = randomUUID()

const sessionTitle = (title: string) => ({
	_tag: 'session_title' as const,
	agentId: null,
	parentAgentId: null,
	toolCallId: null,
	title,
})

const makeScriptedFoldModel = (answers: ReadonlyArray<string>) =>
	Effect.gen(function* () {
		const remaining = yield* Ref.make(answers)
		const prompts = yield* Ref.make<ReadonlyArray<Prompt.Prompt>>([])
		const make = LanguageModel.make({
			generateText: () => Effect.die('The fork continuation test only supports streamText'),
			streamText: (options) =>
				Stream.unwrap(
					Ref.update(prompts, (recorded) => [...recorded, options.prompt]).pipe(
						Effect.andThen(
							Ref.modify(remaining, (pending) => {
								const answer = pending[0]
								const parts: ReadonlyArray<Response.StreamPartEncoded> =
									answer === undefined
										? []
										: [
												{ type: 'text-start', id: 'text-1' },
												{ type: 'text-delta', id: 'text-1', delta: answer },
												{ type: 'text-end', id: 'text-1' },
												{
													type: 'finish',
													reason: 'stop',
													response: undefined,
													usage: {
														inputTokens: {
															uncached: 10,
															total: 10,
															cacheRead: undefined,
															cacheWrite: undefined,
														},
														outputTokens: { total: 5, text: 5, reasoning: undefined },
													},
												},
											]
								return [
									answer === undefined
										? Stream.die('Scripted Fold model exhausted')
										: Stream.fromIterable(parts),
									pending.slice(1),
								] as const
							}),
						),
					),
				),
		})

		return {
			model: customModel({
				activeModel: {
					providerId: 'scripted-openai',
					providerKind: 'openai-compatible',
					modelId: 'fork-continuation-test',
					role: null,
					requestedReasoningLevel: 'off',
					reasoning: { _tag: 'disabled' },
				},
				make,
			}),
			prompts: Ref.get(prompts),
		}
	})

describe('Fold event log session', () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: Awaited<ReturnType<typeof createTestDb>>['db']
	let effectRuntime: ReturnType<typeof createRuntimeWithTestPostgresLayer> | undefined
	let organizationId: string
	let dependencies: ReturnType<typeof Layer.mergeAll>

	beforeAll(async () => {
		const testDb = await createTestDb('fold_event_log_boundary')
		cleanupTestDb = testDb.cleanup
		db = testDb.db
		effectRuntime = createRuntimeWithTestPostgresLayer(db)

		const [organization] = await db
			.insert(organizations)
			.values({ name: 'Fold Event Log Boundary Org', workos_organization_id: `workos-org-${randomUUID()}` })
			.returning()
		if (!organization) throw new Error('Unable to insert organization for setup')
		organizationId = organization.id
		await db.insert(onlineHosts).values({ host_id: hostId, user_id: userId, organization_id: organizationId })

		const context = createMockDaemonContext({
			auth: createMockDaemonAuth({ userId, organizationId, hostId }),
			services: { db, dbReadReplica: db },
		})
		const append = bindProcedureToRuntime(liveAppendFoldSessionEventProcedure, effectRuntime)
		const list = bindProcedureToRuntime(liveListFoldSessionEventsProcedure, effectRuntime)
		const link: ClientLink<Record<never, never>> = {
			call: (path, input) => {
				switch (path.join('.')) {
					case 'foldSessionEvents.append':
						return call(append, input as never, { context })
					case 'foldSessionEvents.list':
						return call(list, input as never, { context })
					default:
						return Promise.reject(new Error(`Unexpected daemon API call: ${path.join('.')}`))
				}
			},
		}
		dependencies = Layer.mergeAll(
			DaemonApiLive(createORPCClient<ORPCClient>(link)),
			layerLiveIdFactory,
			NodeServices.layer,
		)
	}, 30_000)

	afterAll(async () => {
		await effectRuntime?.dispose()
		await cleanupTestDb?.()
	}, 30_000)

	const createSession = async () => {
		const [session] = await db
			.insert(sessions)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: userId,
				created_by: userId,
				host_id: hostId,
				working_directory: '/tmp/fold-event-log-boundary',
				coding_agent: 'fold',
				provider: 'codex',
				model: 'gpt-5.4',
				permissions_mode: 'default',
				status: 'running',
			})
			.returning()
		if (!session) throw new Error('Unable to insert session for setup')
		return session
	}

	it.effect('persists through the real API boundary and reconstructs a fresh scoped log', () =>
		Effect.gen(function* () {
			const session = yield* Effect.promise(createSession)
			const appendedEntries = yield* Effect.scoped(
				Effect.gen(function* () {
					const eventLog = yield* makeFoldEventLogSession({ sessionId: session.id })
					const first = yield* eventLog.append(sessionTitle('first'))
					const second = yield* eventLog.append(sessionTitle('second'))
					return [first, second] as const
				}).pipe(Effect.provide(dependencies)),
			)

			const rows = yield* Effect.promise(() =>
				db
					.select()
					.from(foldSessionEvents)
					.where(eq(foldSessionEvents.session_id, session.id))
					.orderBy(asc(foldSessionEvents.seq)),
			)
			expect(rows).toMatchObject(
				appendedEntries.map((entry) => ({
					session_id: session.id,
					seq: entry.seq,
					event_id: entry.eventId,
					ts: entry.ts,
					event: entry,
				})),
			)

			const replayedEntries = yield* Effect.scoped(
				Effect.gen(function* () {
					const eventLog = yield* makeFoldEventLogSession({ sessionId: session.id })
					return yield* eventLog.entries().pipe(Stream.runCollect)
				}).pipe(Effect.provide(dependencies)),
			)

			expect(replayedEntries).toEqual(appendedEntries)
			expect(replayedEntries.map((entry) => entry.seq)).toEqual([0, 1])
		}),
	)

	it.effect('replays a gapped log best-effort and appends after its highest sequence', () =>
		Effect.gen(function* () {
			const session = yield* Effect.promise(createSession)
			yield* Effect.scoped(
				Effect.gen(function* () {
					const eventLog = yield* makeFoldEventLogSession({ sessionId: session.id })
					yield* eventLog.append(sessionTitle('zero'))
					yield* eventLog.append(sessionTitle('one'))
					yield* eventLog.append(sessionTitle('two'))
				}).pipe(Effect.provide(dependencies)),
			)
			yield* Effect.promise(() =>
				db
					.delete(foldSessionEvents)
					.where(and(eq(foldSessionEvents.session_id, session.id), eq(foldSessionEvents.seq, 1))),
			)

			const result = yield* Effect.scoped(
				Effect.gen(function* () {
					const eventLog = yield* makeFoldEventLogSession({ sessionId: session.id })
					const replayed = yield* eventLog.entries().pipe(Stream.runCollect)
					const appended = yield* eventLog.append(sessionTitle('three'))
					return { replayed, appended }
				}).pipe(Effect.provide(dependencies)),
			)

			expect(result.replayed.map((entry) => entry.seq)).toEqual([0, 2])
			expect(result.appended.seq).toBe(3)
		}),
	)

	it.effect('resumes a Fold session from rows persisted through the real API boundary', () =>
		Effect.gen(function* () {
			const session = yield* Effect.promise(createSession)
			const collections = {
				sessions: { get: (sessionId: string) => (sessionId === session.id ? session : undefined) },
			} as DaemonServices['collections']
			const openerDependencies = Layer.mergeAll(
				dependencies,
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
					ensureTaskSync: () => Effect.die('Taskless Fold session unexpectedly requested task sync'),
				}),
				Layer.succeed(ConfiguredRepoContext, {
					loadForWorkspace: () =>
						Effect.die('Taskless Fold session unexpectedly loaded configured repositories'),
				}),
				Layer.succeed(TaskDiffServiceRegistry, {
					requestCapture: () => Effect.void,
					registerWorkspace: () => Effect.void,
					suspendWorkspace: () => Effect.void,
					resumeWorkspace: () => Effect.void,
					drain: Effect.void,
				}),
			)
			const openerLayer = FoldSessionOpenerLive.pipe(Layer.provideMerge(openerDependencies))

			const firstRootAgentId = yield* Effect.scoped(
				Effect.gen(function* () {
					const opener = yield* FoldSessionOpener
					const opened = yield* opener.open({ sessionId: session.id })
					yield* opened.setTitle('persisted title')
					return opened.rootAgentId
				}).pipe(Effect.provide(openerLayer)),
			)
			const resumed = yield* Effect.scoped(
				Effect.gen(function* () {
					const opener = yield* FoldSessionOpener
					const opened = yield* opener.open({ sessionId: session.id })
					return { rootAgentId: opened.rootAgentId, entries: yield* opened.entries }
				}).pipe(Effect.provide(openerLayer)),
			)

			expect(resumed.rootAgentId).toBe(firstRootAgentId)
			expect(
				resumed.entries.some(
					(entry) =>
						Predicate.isTagged(entry, 'agent_started') &&
						entry.agentId === firstRootAgentId &&
						entry.promptCacheKey === session.id,
				),
			).toBe(true)
			expect(
				resumed.entries.some(
					(entry) => Predicate.isTagged(entry, 'session_title') && entry.title === 'persisted title',
				),
			).toBe(true)
		}),
	)

	it.effect('forks at a selected turn and continues source and child independently through Postgres', () =>
		Effect.gen(function* () {
			const sourceSessionId = uuidv7()
			yield* Effect.promise(() =>
				db.insert(sessions).values({
					id: sourceSessionId,
					organization_id: organizationId,
					resource_owner_user_id: userId,
					created_by: userId,
					host_id: hostId,
					working_directory: '/tmp/fold-fork-continuation',
					coding_agent: 'fold',
					provider: 'codex',
					model: 'gpt-5.4',
					effort: 'low',
					permissions_mode: 'default',
					status: 'ready_for_input',
					title: 'Runtime fork source',
				}),
			)

			const initialModel = yield* makeScriptedFoldModel(['shared initial answer'])
			const initial = yield* Effect.scoped(
				Effect.gen(function* () {
					const session = yield* startSession({
						agent: defineAgent({
							model: initialModel.model,
							systemPrompt: 'Continue the selected-turn fork test.',
							promptCacheKey: sourceSessionId,
						}),
						cwd: '/tmp/fold-fork-continuation',
						log: eventLogSource(
							makeFoldEventLogSession({ sessionId: sourceSessionId }).pipe(Effect.provide(dependencies)),
						),
					})
					const result = yield* session.send('shared initial prompt')
					return { result, entries: yield* session.entries, foldSessionId: session.sessionId }
				}),
			)
			expect(initial.result.resultText).toBe('shared initial answer')
			yield* Effect.promise(() =>
				db
					.update(sessions)
					.set({ coding_agent_session_id: initial.foldSessionId })
					.where(eq(sessions.id, sourceSessionId)),
			)

			const initialUser = initial.entries.find((entry) => Predicate.isTagged(entry, 'user-message'))
			const initialAssistant = initial.entries.find((entry) => Predicate.isTagged(entry, 'assistant-message'))
			if (initialUser === undefined || initialAssistant === undefined) {
				return yield* Effect.die('The initial Fold turn did not produce user and assistant messages')
			}
			const baseTime = BigInt(yield* Clock.currentTimeMillis)
			const forkAtEventId = uuidv7()
			yield* Effect.promise(() =>
				db.insert(conversationEvents).values([
					{
						id: uuidv7(),
						session_id: sourceSessionId,
						organization_id: organizationId,
						resource_owner_user_id: userId,
						event_type: 'message',
						role: 'user',
						content: 'shared initial prompt',
						coding_agent_event_id: initialUser.eventId,
						created_at: baseTime,
						updated_at: baseTime,
					},
					{
						id: uuidv7(),
						session_id: sourceSessionId,
						organization_id: organizationId,
						resource_owner_user_id: userId,
						event_type: 'message',
						role: 'assistant',
						content: 'shared initial answer',
						coding_agent_event_id: initialAssistant.eventId,
						created_at: baseTime + 1n,
						updated_at: baseTime + 1n,
					},
					{
						id: forkAtEventId,
						session_id: sourceSessionId,
						organization_id: organizationId,
						resource_owner_user_id: userId,
						event_type: 'message',
						role: 'user',
						content: 'selected turn to replace',
						created_at: baseTime + 2n,
						updated_at: baseTime + 2n,
					},
				]),
			)

			const fork = yield* Effect.promise(() =>
				call(
					forkSessionV2Procedure,
					{
						codingAgent: 'fold',
						sourceSessionId,
						forkAtEventId,
						text: 'child continuation prompt',
					},
					{
						context: createMockApiContext({
							auth: createMockApiAuth({ userId, organizationId }),
							services: { db, dbReadReplica: db },
						}),
					},
				),
			)
			const childSessionId = fork.session.id
			if (fork.session.coding_agent_session_id === null) {
				return yield* Effect.die('The fork procedure did not assign a child Fold session identity')
			}
			const childFoldSessionId = yield* Schema.decodeUnknownEffect(SessionId)(
				fork.session.coding_agent_session_id,
			)

			const continueSession = (input: {
				readonly riptideSessionId: string
				readonly promptCacheKey: string
				readonly prompt: string
				readonly answer: string
			}) =>
				Effect.gen(function* () {
					const scripted = yield* makeScriptedFoldModel([input.answer])
					const result = yield* Effect.scoped(
						Effect.gen(function* () {
							const session = yield* resumeSession({
								agent: defineAgent({
									model: scripted.model,
									systemPrompt: 'Continue the selected-turn fork test.',
									promptCacheKey: input.promptCacheKey,
								}),
								log: eventLogSource(
									makeFoldEventLogSession({ sessionId: input.riptideSessionId }).pipe(
										Effect.provide(dependencies),
									),
								),
							})
							return yield* session.send(input.prompt)
						}),
					)
					return { result, prompts: JSON.stringify(yield* scripted.prompts) }
				})

			const sourceContinuation = yield* continueSession({
				riptideSessionId: sourceSessionId,
				promptCacheKey: sourceSessionId,
				prompt: 'source continuation prompt',
				answer: 'source-only answer',
			})
			const childContinuation = yield* continueSession({
				riptideSessionId: childSessionId,
				promptCacheKey: childSessionId,
				prompt: 'child continuation prompt',
				answer: 'child-only answer',
			})

			expect(sourceContinuation.result.resultText).toBe('source-only answer')
			expect(childContinuation.result.resultText).toBe('child-only answer')
			expect(sourceContinuation.prompts).toContain('shared initial answer')
			expect(sourceContinuation.prompts).toContain('source continuation prompt')
			expect(sourceContinuation.prompts).not.toContain('child continuation prompt')
			expect(childContinuation.prompts).toContain('shared initial answer')
			expect(childContinuation.prompts).toContain('child continuation prompt')
			expect(childContinuation.prompts).not.toContain('source continuation prompt')

			const childRowsBeforeDelete = yield* Effect.promise(() =>
				db
					.select()
					.from(foldSessionEvents)
					.where(eq(foldSessionEvents.session_id, childSessionId))
					.orderBy(asc(foldSessionEvents.seq)),
			)
			const childSessionStartedRow = childRowsBeforeDelete[0]
			if (childSessionStartedRow === undefined) {
				return yield* Effect.die('The child Fold log is missing its session_started entry')
			}
			const childSessionStarted = yield* decodePersistedFoldEntry(childSessionStartedRow.event)
			if (!Predicate.isTagged(childSessionStarted, 'session_started')) {
				return yield* Effect.die('The child Fold log does not begin with session_started')
			}
			expect(childSessionStarted.sessionId).toBe(childFoldSessionId)
			expect(JSON.stringify(childRowsBeforeDelete)).toContain('child-only answer')
			expect(JSON.stringify(childRowsBeforeDelete)).not.toContain('source-only answer')

			yield* Effect.promise(() => db.delete(sessions).where(eq(sessions.id, sourceSessionId)))
			const childAfterSourceDelete = yield* continueSession({
				riptideSessionId: childSessionId,
				promptCacheKey: childSessionId,
				prompt: 'continue after source deletion',
				answer: 'child survived source deletion',
			})
			expect(childAfterSourceDelete.result.resultText).toBe('child survived source deletion')

			const [childRow] = yield* Effect.promise(() =>
				db.select().from(sessions).where(eq(sessions.id, childSessionId)).limit(1),
			)
			const childConversation = yield* Effect.promise(() =>
				db.select().from(conversationEvents).where(eq(conversationEvents.session_id, childSessionId)),
			)
			const finalChildLog = yield* Effect.promise(() =>
				db
					.select()
					.from(foldSessionEvents)
					.where(eq(foldSessionEvents.session_id, childSessionId))
					.orderBy(asc(foldSessionEvents.seq)),
			)
			expect(childRow?.forked_from_session_id).toBeNull()
			expect(childConversation.map((event) => event.content)).toEqual(
				expect.arrayContaining(['shared initial prompt', 'shared initial answer', 'child continuation prompt']),
			)
			expect(JSON.stringify(finalChildLog)).toContain('child survived source deletion')
		}).pipe(Effect.provide(dependencies)),
	)

	it.effect('replays a finite snapshot and hands off to live entries without a gap', () =>
		Effect.gen(function* () {
			const session = yield* Effect.promise(createSession)
			const replay = yield* Effect.scoped(
				Effect.gen(function* () {
					const eventLog = yield* makeFoldEventLogSession({ sessionId: session.id })
					yield* eventLog.append(sessionTitle('zero'))
					yield* eventLog.append(sessionTitle('one'))
					yield* eventLog.append(sessionTitle('two'))
					const replayedEntries = yield* eventLog.entries(1).pipe(Stream.runCollect)
					const snapshotObserved = yield* Deferred.make<void>()
					const liveEntriesFiber = yield* eventLog.subscribe().pipe(
						Stream.tap((entry) =>
							entry.seq === 0 ? Deferred.succeed(snapshotObserved, undefined) : Effect.void,
						),
						Stream.take(4),
						Stream.runCollect,
						Effect.forkChild,
					)
					yield* Deferred.await(snapshotObserved)
					yield* eventLog.append(sessionTitle('three'))

					return { replayedEntries, liveEntries: yield* Fiber.join(liveEntriesFiber) }
				}).pipe(Effect.provide(dependencies)),
			)

			expect(replay.replayedEntries.map((entry) => entry.seq)).toEqual([1, 2])
			expect(replay.liveEntries.map((entry) => entry.seq)).toEqual([0, 1, 2, 3])
		}),
	)

	it.effect('preserves Fold unsupported-version errors from real persisted rows', () =>
		Effect.gen(function* () {
			const session = yield* Effect.promise(createSession)
			const futureEntry = {
				_tag: 'session_title',
				seq: 0,
				eventId: `event_${randomUUID().replaceAll('-', '')}`,
				ts: 1,
				version: 2,
				agentId: null,
				parentAgentId: null,
				toolCallId: null,
				title: 'Future session',
			}
			yield* Effect.promise(() =>
				db.insert(foldSessionEvents).values({
					session_id: session.id,
					seq: futureEntry.seq,
					event_id: futureEntry.eventId,
					ts: futureEntry.ts,
					event: futureEntry,
				}),
			)

			const error = yield* Effect.scoped(
				makeFoldEventLogSession({ sessionId: session.id }).pipe(Effect.provide(dependencies)),
			).pipe(Effect.flip)

			expect(error).toBeInstanceOf(EventLogUnsupportedVersionError)
			if (error instanceof EventLogUnsupportedVersionError) {
				expect(error.version).toBe(2)
				expect(error.seq).toBe(0)
				expect(error.supportedVersions).toEqual([1])
			}
		}),
	)
})
