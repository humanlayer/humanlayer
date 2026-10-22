import { NodeServices } from '@effect/platform-node'
import { describe, it } from '@effect/vitest'
import {
	AgentId,
	EventId,
	SessionId,
	runtimeForAgent,
	type ActiveModel,
	type FoldSession,
	type LogEntry,
} from '@humanlayer/fold-core'
import { Deferred, Effect, Exit, Fiber, Layer, Logger, Queue, Ref, Stream } from 'effect'
import { TestClock } from 'effect/testing'
import { expect } from 'vitest'

import type { DaemonServices } from '@/agents/claudecode/types'
import { DaemonApi } from '@/effects/services/daemon-api/daemon-api.service'
import { DaemonCollections } from '@/effects/services/daemon-collections/daemon-collections.service'
import { DaemonTaskSync } from '@/effects/services/daemon-task-sync'
import { FoldEventProcessor } from '@/effects/services/fold-sessions/fold-event-processor.service'
import type { FoldHostServices } from '@/effects/services/fold-sessions/fold-host-services'
import { FoldSessionOpener } from '@/effects/services/fold-sessions/fold-session-opener.service'
import { FoldSessionRunnerLive } from '@/effects/services/fold-sessions/fold-session-runner.layer'
import { FoldSessionRunner } from '@/effects/services/fold-sessions/fold-session-runner.service'
import {
	FoldPromptTakeoverError,
	FoldSessionsShuttingDownError,
} from '@/effects/services/fold-sessions/fold-sessions.errors'
import { DurableStreamFetch } from '@/effects/services/stream-producer/durable-stream-fetch'
import { StreamProducer } from '@/effects/services/stream-producer/stream-producer.service'
import { GitRunnerConfigurationLive } from '@/effects/services/task-diff/git-command-runner.layer'
import { TaskDiffServiceRegistry } from '@/effects/services/task-diff/task-diff-service-registry.service'
import { ConfiguredRepoContext } from '@/lib/configured-repos/service'

import { initialFoldModel, modelChangedEntry, modelStartedEntry } from '../helpers/fold-model-history'
import { createTestSession, makeSessionChange } from '../helpers/session-fixtures'
import { makeMockDaemonApiLayer } from '../mocks/daemon-api.mock'
import { makeMockTaskWorkspaceContextLayer } from '../mocks/task-workspace-context.mock'

process.env.RIPTIDE_SYNC_ORIGIN = 'http://sync.test'

const sessionRow = {
	id: 'session-1',
	organization_id: 'organization-1',
	host_id: 'host-1',
	task_id: null,
	working_directory: '/tmp/fold',
	provider: 'codex',
	model: 'gpt-5.6-sol',
	effort: 'high',
}

const makeCollections = (row = sessionRow): DaemonServices['collections'] =>
	({
		sessions: { get: (id: string) => (id === row.id ? row : undefined) },
	}) as DaemonServices['collections']

/**
 * How a held send reacts to `interrupt()`. `releases` models a healthy Fold session. `ignores`
 * models a stale prompt that never answers the interrupt. `resists` also cannot be force-stopped.
 */
type HeldSendInterruptBehavior = 'releases' | 'ignores' | 'resists'

const makeSession = Effect.fn('test.makeFoldSession')(function* (
	sendGate?: Deferred.Deferred<void>,
	compactGate?: Deferred.Deferred<void>,
	heldSendInterruptBehavior: HeldSendInterruptBehavior = 'releases',
) {
	const rootAgentId = AgentId.create()
	const history = yield* Ref.make<ReadonlyArray<LogEntry>>([modelStartedEntry(rootAgentId)])
	const switches = yield* Ref.make<ReadonlyArray<ActiveModel>>([])
	const sentModels = yield* Ref.make<ReadonlyArray<ActiveModel>>([])
	const currentModel = yield* Ref.make(initialFoldModel)
	const events =
		yield* Queue.unbounded<ReturnType<FoldSession['events']> extends Stream.Stream<infer A> ? A : never>()
	const sends = yield* Ref.make<ReadonlyArray<string>>([])
	const compactions = yield* Ref.make<ReadonlyArray<string | null>>([])
	const interrupts = yield* Ref.make(0)
	const interruptStarted = yield* Deferred.make<void>()
	const sendStarted = yield* Deferred.make<void>()
	const compactStarted = yield* Deferred.make<void>()
	const session: FoldSession<FoldHostServices> = {
		sessionId: SessionId.create(),
		rootAgentId,
		send: (text) =>
			Effect.gen(function* () {
				const model = yield* Ref.get(currentModel)
				yield* Ref.update(sentModels, (models) => [...models, model])
				yield* Ref.update(sends, (current) => [...current, text])
				yield* Deferred.succeed(sendStarted, void 0)
				if (sendGate !== undefined)
					yield* heldSendInterruptBehavior === 'resists'
						? Effect.uninterruptible(Deferred.await(sendGate))
						: Deferred.await(sendGate)
				const entry = {
					_tag: 'agent-finished' as const,
					seq: (yield* Ref.get(history)).length,
					eventId: EventId.create(),
					ts: 1,
					version: 1 as const,
					agentId: rootAgentId,
					parentAgentId: null,
					toolCallId: null,
					outcome: 'completed' as const,
					resultText: null,
					reason: null,
				}
				yield* Ref.update(history, (entries) => [...entries, entry])
				yield* Queue.offer(events, { kind: 'log' as const, entry })
				return entry
			}),
		steer: () => Effect.void,
		injectSkill: () => Effect.die('injectSkill should not run'),
		stop: () => Effect.void,
		interrupt: () =>
			Ref.update(interrupts, (count) => count + 1).pipe(
				Effect.andThen(Deferred.succeed(interruptStarted, void 0)),
				Effect.andThen(
					sendGate === undefined || heldSendInterruptBehavior !== 'releases'
						? Effect.void
						: Deferred.succeed(sendGate, void 0),
				),
			),
		switchModel: (model) =>
			Effect.gen(function* () {
				yield* Ref.set(currentModel, model.activeModel)
				yield* Ref.update(switches, (models) => [...models, model.activeModel])
				yield* Ref.update(history, (entries) => [
					...entries,
					modelChangedEntry(rootAgentId, model.activeModel, entries.length),
				])
			}),
		compact: (options?: { readonly additionalInstructions?: string | null }) =>
			Effect.gen(function* () {
				yield* Ref.update(compactions, (current) => [...current, options?.additionalInstructions ?? null])
				yield* Deferred.succeed(compactStarted, void 0)
				if (compactGate !== undefined) yield* Deferred.await(compactGate)
				return null
			}),
		setProfile: () => Effect.void,
		events: () => Stream.fromQueue(events),
		entries: Ref.get(history),
		setTitle: () => Effect.void,
	}
	return {
		session,
		sends,
		compactions,
		interrupts,
		interruptStarted,
		sendStarted,
		compactStarted,
		switches,
		sentModels,
	}
})

const emptyFetch: typeof fetch = Object.assign(
	() => Promise.resolve(new Response('[]', { headers: { 'content-type': 'application/json' } })),
	{ preconnect: () => {} },
)

/** One structured Fold ownership record, in the shape the daemon writes to its Effect JSONL log. */
interface FoldOwnershipRecord {
	readonly message: 'fold_prompt_admission' | 'fold_prompt_lifecycle'
	readonly level: string
	readonly fields: Readonly<Record<string, unknown>>
}

const isFoldOwnershipMessage = (message: unknown): message is FoldOwnershipRecord['message'] =>
	message === 'fold_prompt_admission' || message === 'fold_prompt_lifecycle'

/** Capture the runner's ownership records in order, and let a test wait for a specific one. */
const makeFoldOwnershipRecordCapture = Effect.fn('test.makeFoldOwnershipRecordCapture')(function* () {
	const records: FoldOwnershipRecord[] = []
	const arrivals = yield* Queue.unbounded<FoldOwnershipRecord>()
	const loggerLayer = Logger.layer([
		Logger.map(Logger.formatStructured, (output) => {
			if (!isFoldOwnershipMessage(output.message)) return
			const record = { message: output.message, level: output.level, fields: output.annotations }
			records.push(record)
			Queue.offerUnsafe(arrivals, record)
		}),
	])
	const awaitRecord = Effect.fn('test.awaitFoldOwnershipRecord')(function* (
		expected: Readonly<Record<string, unknown>>,
	) {
		while (true) {
			const record = yield* Queue.take(arrivals)
			if (Object.entries(expected).every(([key, value]) => record.fields[key] === value)) return record
		}
	})
	return { records, loggerLayer, awaitRecord }
})

const ownershipFields = (records: ReadonlyArray<FoldOwnershipRecord>, keys: ReadonlyArray<string>) =>
	records.map((record) =>
		Object.fromEntries(keys.filter((key) => key in record.fields).map((key) => [key, record.fields[key]])),
	)

const makeDependencies = (input?: {
	readonly row?: typeof sessionRow
	readonly durableStreamFetch?: typeof fetch
	readonly processEmittedEvent?: typeof FoldEventProcessor.Service.processEmittedEvent
	readonly open?: (input: {
		readonly sessionId: string
	}) => Effect.Effect<FoldSession<FoldHostServices>, never, never>
	readonly sessionChanges?: Stream.Stream<ReturnType<typeof makeSessionChange>>
	readonly updateSession?: (typeof DaemonApi.Service)['updateSession']
}) =>
	Layer.mergeAll(
		GitRunnerConfigurationLive,
		makeMockDaemonApiLayer({
			ensureConversationStream: () => Effect.succeed({ sessionId: sessionRow.id, status: 'exists' as const }),
			updateSession:
				input?.updateSession ??
				(() => Effect.succeed({ success: true as const, transactionId: 'transaction-1' })),
		}),
		Layer.succeed(DurableStreamFetch, { fetch: input?.durableStreamFetch ?? emptyFetch }),
		Layer.succeed(FoldSessionOpener, {
			open: input?.open ?? (() => Effect.die('session opener should not run')),
		}),
		Layer.succeed(DaemonTaskSync, {
			ensureTaskSync: () => Effect.die('runner test unexpectedly requested task sync'),
		}),
		Layer.succeed(ConfiguredRepoContext, {
			loadForWorkspace: () => Effect.die('runner test unexpectedly loaded configured repositories'),
		}),
		makeMockTaskWorkspaceContextLayer(),
		Layer.succeed(TaskDiffServiceRegistry, {
			requestCapture: () => Effect.void,
			registerWorkspace: () => Effect.void,
			suspendWorkspace: () => Effect.void,
			resumeWorkspace: () => Effect.void,
			drain: Effect.void,
		}),
		NodeServices.layer,
		Layer.succeed(FoldEventProcessor, { processEmittedEvent: input?.processEmittedEvent ?? (() => Effect.void) }),
		Layer.succeed(DaemonCollections, {
			current: Effect.succeed(makeCollections(input?.row)),
			sessionChanges: Stream.never,
			taskChanges: Stream.never,
			approvalChanges: Stream.never,
			workspaceSetupChanges: Stream.never,
			providerLoginChanges: Stream.never,
			workspaceSetups: Stream.never,
			workspaceSetupSessions: Stream.never,
			streamSessionChanges: () => input?.sessionChanges ?? Stream.never,
			streamApprovalChanges: () => Stream.never,
		}),
	)

const makeRunnerLayer = (dependencies: ReturnType<typeof makeDependencies>) =>
	FoldSessionRunnerLive.pipe(Layer.provideMerge(dependencies))

describe('FoldSessionRunner', () => {
	it.effect('reconciles the persisted model on resume and seeds projection history before new events', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const testSession = yield* makeSession()
				const projectedHistories = yield* Ref.make<ReadonlyArray<ReadonlyArray<LogEntry>>>([])
				const dependencies = makeDependencies({
					row: { ...sessionRow, model: 'gpt-6-astra', effort: 'max' },
					open: () => Effect.succeed(testSession.session),
					processEmittedEvent: ({ history }) =>
						Ref.update(projectedHistories, (all) => [...all, [...history]]),
				})
				yield* FoldSessionRunner.pipe(
					Effect.flatMap((runner) => runner.runPrompt({ sessionId: sessionRow.id, prompt: 'resumed' })),
					Effect.provide(makeRunnerLayer(dependencies)),
				)
				const histories = yield* Ref.get(projectedHistories)
				expect(histories).toHaveLength(1)
				for (const history of histories) {
					expect(history).toMatchObject([
						{ _tag: 'agent_started', model: { modelId: 'gpt-5.6-sol' } },
						{ _tag: 'model-change', model: { modelId: 'gpt-6-astra' } },
						{ _tag: 'agent-finished' },
					])
					expect(runtimeForAgent(history, testSession.session.rootAgentId).activeModel?.modelId).toBe(
						'gpt-6-astra',
					)
				}
				expect(yield* Ref.get(testSession.sentModels)).toMatchObject([
					{ modelId: 'gpt-6-astra', requestedReasoningLevel: 'max' },
				])
			}),
		),
	)
	for (const update of [
		{ model: 'gpt-6-astra', effort: 'high' },
		{ model: 'gpt-5.6-sol', effort: 'low' },
	]) {
		it.effect(`reconciles idle settings ${update.model}/${update.effort} without reopening`, () =>
			Effect.scoped(
				Effect.gen(function* () {
					const row = { ...sessionRow }
					const testSession = yield* makeSession()
					const opens = yield* Ref.make(0)
					const dependencies = makeDependencies({
						row,
						open: () => Ref.update(opens, (count) => count + 1).pipe(Effect.as(testSession.session)),
					})
					yield* Effect.gen(function* () {
						const runner = yield* FoldSessionRunner
						yield* runner.runPrompt({ sessionId: row.id, prompt: 'first' })
						Object.assign(row, update)
						yield* runner.runPrompt({ sessionId: row.id, prompt: 'second' })
						yield* runner.runPrompt({ sessionId: row.id, prompt: 'unchanged' })
					}).pipe(Effect.provide(makeRunnerLayer(dependencies)))
					expect(yield* Ref.get(opens)).toBe(1)
					expect(yield* Ref.get(testSession.switches)).toMatchObject([
						{ modelId: update.model, requestedReasoningLevel: update.effort },
					])
					expect(yield* Ref.get(testSession.sentModels)).toMatchObject([
						{ modelId: sessionRow.model, requestedReasoningLevel: sessionRow.effort },
						{ modelId: update.model, requestedReasoningLevel: update.effort },
						{ modelId: update.model, requestedReasoningLevel: update.effort },
					])
				}),
			),
		)
	}
	it.effect('rejects prompts after shutdown begins without opening a session', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const runner = yield* FoldSessionRunner
				yield* runner.shutdownActiveSessions
				const error = yield* runner.runPrompt({ sessionId: 'session-1', prompt: 'hello' }).pipe(Effect.flip)

				expect(error).toBeInstanceOf(FoldSessionsShuttingDownError)
			}).pipe(Effect.provide(makeRunnerLayer(makeDependencies()))),
		),
	)

	it.effect('reuses a warm session for sequential prompts', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const testSession = yield* makeSession()
				const opens = yield* Ref.make(0)
				const dependencies = makeDependencies({
					open: () => Ref.update(opens, (count) => count + 1).pipe(Effect.as(testSession.session)),
				})
				yield* Effect.gen(function* () {
					const runner = yield* FoldSessionRunner
					yield* runner.runPrompt({ sessionId: sessionRow.id, prompt: 'first' })
					yield* runner.runPrompt({ sessionId: sessionRow.id, prompt: 'second' })
				}).pipe(Effect.provide(makeRunnerLayer(dependencies)))

				expect(yield* Ref.get(opens)).toBe(1)
				expect(yield* Ref.get(testSession.sends)).toEqual(['first', 'second'])
			}),
		),
	)

	it.effect('marks ordinary prompts running before Fold starts model work', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const sendGate = yield* Deferred.make<void>()
				const testSession = yield* makeSession(sendGate)
				const updates = yield* Ref.make<ReadonlyArray<Record<string, unknown>>>([])
				const dependencies = makeDependencies({
					open: () => Effect.succeed(testSession.session),
					updateSession: (input) =>
						Ref.update(updates, (current) => [...current, input]).pipe(
							Effect.as({ success: true, transactionId: 'transaction-status' }),
						),
				})
				yield* Effect.gen(function* () {
					const runner = yield* FoldSessionRunner
					const run = yield* runner
						.runPrompt({ sessionId: sessionRow.id, prompt: 'hello' })
						.pipe(Effect.forkScoped)
					yield* Deferred.await(testSession.sendStarted)

					expect(yield* Ref.get(updates)).toContainEqual(
						expect.objectContaining({ sessionId: sessionRow.id, status: 'running' }),
					)

					yield* Deferred.succeed(sendGate, void 0)
					yield* Fiber.join(run)
				}).pipe(Effect.provide(makeRunnerLayer(dependencies)))
			}),
		),
	)

	it.effect('dispatches compact commands to Fold without sending a model prompt', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const testSession = yield* makeSession()
				const dependencies = makeDependencies({ open: () => Effect.succeed(testSession.session) })
				yield* Effect.gen(function* () {
					const runner = yield* FoldSessionRunner
					yield* runner.runPrompt({ sessionId: sessionRow.id, prompt: '/compact' })
					yield* runner.runPrompt({
						sessionId: sessionRow.id,
						prompt: '/compact Preserve commands.\n\nPreserve failed approaches.',
					})
				}).pipe(Effect.provide(makeRunnerLayer(dependencies)))

				expect(yield* Ref.get(testSession.sends)).toEqual([])
				expect(yield* Ref.get(testSession.compactions)).toEqual([
					null,
					'Preserve commands.\n\nPreserve failed approaches.',
				])
			}),
		),
	)

	it.effect('keeps compact commands running until compaction settles', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const compactGate = yield* Deferred.make<void>()
				const testSession = yield* makeSession(undefined, compactGate)
				const updates = yield* Ref.make<ReadonlyArray<Record<string, unknown>>>([])
				const dependencies = makeDependencies({
					open: () => Effect.succeed(testSession.session),
					updateSession: (input) =>
						Ref.update(updates, (current) => [...current, input]).pipe(
							Effect.as({ success: true, transactionId: 'transaction-status' }),
						),
				})
				yield* Effect.gen(function* () {
					const runner = yield* FoldSessionRunner
					const run = yield* runner
						.runPrompt({ sessionId: sessionRow.id, prompt: '/compact' })
						.pipe(Effect.forkScoped)
					yield* Deferred.await(testSession.compactStarted)

					expect(yield* Ref.get(updates)).toEqual([
						expect.objectContaining({ sessionId: sessionRow.id, status: 'running' }),
					])

					yield* Deferred.succeed(compactGate, void 0)
					yield* Fiber.join(run)
					expect(yield* Ref.get(updates)).toEqual([
						expect.objectContaining({ sessionId: sessionRow.id, status: 'running' }),
						expect.objectContaining({ sessionId: sessionRow.id, status: 'ready_for_input' }),
					])
				}).pipe(Effect.provide(makeRunnerLayer(dependencies)))
			}),
		),
	)

	it.effect('sends compact-like ordinary text as a model prompt', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const testSession = yield* makeSession()
				const dependencies = makeDependencies({ open: () => Effect.succeed(testSession.session) })
				yield* Effect.gen(function* () {
					const runner = yield* FoldSessionRunner
					yield* runner.runPrompt({ sessionId: sessionRow.id, prompt: 'please /compact this explanation' })
				}).pipe(Effect.provide(makeRunnerLayer(dependencies)))

				expect(yield* Ref.get(testSession.sends)).toEqual(['please /compact this explanation'])
				expect(yield* Ref.get(testSession.compactions)).toEqual([])
			}),
		),
	)

	it.effect('serializes prompts targeting the same session', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const capture = yield* makeFoldOwnershipRecordCapture()
				const firstGate = yield* Deferred.make<void>()
				const testSession = yield* makeSession(firstGate)
				const dependencies = makeDependencies({ open: () => Effect.succeed(testSession.session) })
				yield* Effect.gen(function* () {
					const runner = yield* FoldSessionRunner
					const first = yield* runner
						.runPrompt({ sessionId: sessionRow.id, prompt: 'first' })
						.pipe(Effect.forkScoped)
					yield* Deferred.await(testSession.sendStarted)
					const second = yield* runner
						.runPrompt({ sessionId: sessionRow.id, prompt: 'second', admissionPolicy: 'serialize' })
						.pipe(Effect.forkScoped)
					yield* Effect.yieldNow
					expect(yield* Ref.get(testSession.sends)).toEqual(['first'])
					yield* Deferred.succeed(firstGate, void 0)
					yield* Fiber.join(first)
					yield* Fiber.join(second)
				}).pipe(Effect.provide(makeRunnerLayer(dependencies)), Effect.provide(capture.loggerLayer))

				expect(yield* Ref.get(testSession.sends)).toEqual(['first', 'second'])
				expect(yield* Ref.get(testSession.interrupts)).toBe(0)
				expect(
					ownershipFields(
						capture.records.filter((record) => record.message === 'fold_prompt_admission'),
						['claim_id', 'outcome', 'prior_claim_id'],
					),
				).toEqual([
					{ claim_id: 'fold-claim-1', outcome: 'acquired' },
					{ claim_id: 'fold-claim-2', outcome: 'waiting', prior_claim_id: 'fold-claim-1' },
					{ claim_id: 'fold-claim-2', outcome: 'acquired', prior_claim_id: 'fold-claim-1' },
				])
			}),
		),
	)

	it.effect('interrupts active work during shutdown and rejects later prompts', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const sendGate = yield* Deferred.make<void>()
				const testSession = yield* makeSession(sendGate)
				const dependencies = makeDependencies({ open: () => Effect.succeed(testSession.session) })
				yield* Effect.gen(function* () {
					const runner = yield* FoldSessionRunner
					const active = yield* runner
						.runPrompt({ sessionId: sessionRow.id, prompt: 'running' })
						.pipe(Effect.forkScoped)
					yield* Deferred.await(testSession.sendStarted)
					yield* runner.shutdownActiveSessions
					yield* Fiber.join(active)
					expect(yield* Ref.get(testSession.interrupts)).toBe(1)

					const error = yield* runner
						.runPrompt({ sessionId: sessionRow.id, prompt: 'too late' })
						.pipe(Effect.flip)
					expect(error).toBeInstanceOf(FoldSessionsShuttingDownError)
				}).pipe(Effect.provide(makeRunnerLayer(dependencies)))
			}),
		),
	)

	it.effect('keeps an active response on its original model and applies the latest settings next turn', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const firstGate = yield* Deferred.make<void>()
				const firstSession = yield* makeSession(firstGate)
				const row = { ...sessionRow }
				const changes = yield* Queue.unbounded<ReturnType<typeof makeSessionChange>>()
				const observed = yield* Deferred.make<void>()
				const opens = yield* Ref.make(0)
				const dependencies = makeDependencies({
					row,
					open: () => Ref.update(opens, (count) => count + 1).pipe(Effect.as(firstSession.session)),
					sessionChanges: Stream.fromQueue(changes).pipe(
						Stream.tap(() => Deferred.succeed(observed, void 0)),
					),
				})

				yield* Effect.gen(function* () {
					const runner = yield* FoldSessionRunner
					const first = yield* runner
						.runPrompt({ sessionId: sessionRow.id, prompt: 'first' })
						.pipe(Effect.forkScoped)
					yield* Deferred.await(firstSession.sendStarted)
					row.model = 'gpt-5.4'
					row.effort = 'low'
					yield* Queue.offer(
						changes,
						makeSessionChange({
							type: 'update',
							value: createTestSession({ id: sessionRow.id, status: 'running', model: 'gpt-5.4' }),
							previousValue: { model: 'gpt-5.3-codex' },
						}),
					)
					yield* Deferred.await(observed)
					expect(yield* Ref.get(firstSession.switches)).toEqual([])
					row.model = 'gpt-6-astra'
					row.effort = 'max'
					yield* Deferred.succeed(firstGate, void 0)
					yield* Fiber.join(first)
					yield* runner.runPrompt({ sessionId: sessionRow.id, prompt: 'second' })
				}).pipe(Effect.provide(makeRunnerLayer(dependencies)))

				expect(yield* Ref.get(opens)).toBe(1)
				expect(yield* Ref.get(firstSession.sentModels)).toMatchObject([
					{ modelId: 'gpt-5.6-sol', requestedReasoningLevel: 'high' },
					{ modelId: 'gpt-6-astra', requestedReasoningLevel: 'max' },
				])
			}),
		),
	)

	describe('lost-session recovery', () => {
		const recordStatuses = (statuses: Ref.Ref<ReadonlyArray<string | undefined>>) =>
			((input) =>
				Ref.update(statuses, (current) => [...current, input.status]).pipe(
					Effect.as({ success: true as const, transactionId: 'transaction-status' }),
				)) satisfies (typeof DaemonApi.Service)['updateSession']

		it.effect('replaces a stale prompt only after its terminal projection settles', () =>
			Effect.scoped(
				Effect.gen(function* () {
					const staleSendGate = yield* Deferred.make<void>()
					const testSession = yield* makeSession(staleSendGate)
					const statuses = yield* Ref.make<ReadonlyArray<string | undefined>>([])
					const projections = yield* Ref.make(0)
					const staleProjectionStarted = yield* Deferred.make<void>()
					const staleProjectionGate = yield* Deferred.make<void>()
					const dependencies = makeDependencies({
						open: () => Effect.succeed(testSession.session),
						updateSession: recordStatuses(statuses),
						processEmittedEvent: () =>
							Effect.gen(function* () {
								const projection = yield* Ref.updateAndGet(projections, (count) => count + 1)
								if (projection !== 1) return
								yield* Deferred.succeed(staleProjectionStarted, void 0)
								yield* Deferred.await(staleProjectionGate)
							}),
					})
					yield* Effect.gen(function* () {
						const runner = yield* FoldSessionRunner
						const stale = yield* runner
							.runPrompt({ sessionId: sessionRow.id, prompt: 'stale' })
							.pipe(Effect.forkScoped)
						yield* Deferred.await(testSession.sendStarted)
						const resumed = yield* runner
							.runPrompt({ sessionId: sessionRow.id, prompt: 'resumed', admissionPolicy: 'recover-lost' })
							.pipe(Effect.forkScoped)
						yield* Deferred.await(staleProjectionStarted)

						// The stale prompt is interrupted but still projecting: the replacement must not own yet.
						expect(yield* Ref.get(testSession.interrupts)).toBe(1)
						expect(yield* Ref.get(statuses)).toEqual(['running'])
						expect(yield* Ref.get(testSession.sends)).toEqual(['stale'])

						yield* Deferred.succeed(staleProjectionGate, void 0)
						yield* Fiber.join(stale)
						yield* Fiber.join(resumed)
					}).pipe(Effect.provide(makeRunnerLayer(dependencies)))

					expect(yield* Ref.get(statuses)).toEqual(['running', 'running'])
					expect(yield* Ref.get(testSession.sends)).toEqual(['stale', 'resumed'])
				}),
			),
		)

		it.effect('holds the replacement until the stale prompt finishes durable-writer cleanup', () =>
			Effect.scoped(
				Effect.gen(function* () {
					const capture = yield* makeFoldOwnershipRecordCapture()
					const staleSendGate = yield* Deferred.make<void>()
					const testSession = yield* makeSession(staleSendGate)
					const statuses = yield* Ref.make<ReadonlyArray<string | undefined>>([])
					// The stale prompt's first stream POST stays open, so its writer flush in the prompt
					// scope finalizer cannot finish until the test answers it.
					const posts = yield* Queue.unbounded<RequestInit>()
					const stalePostResponse = Promise.withResolvers<Response>()
					let postCount = 0
					const holdFirstStreamPost = Object.assign(
						async (request: Parameters<typeof fetch>[0], init?: RequestInit) => {
							if (init?.method !== 'POST') return emptyFetch(request, init)
							postCount += 1
							Queue.offerUnsafe(posts, init)
							return postCount === 1 ? stalePostResponse.promise : new Response(null, { status: 200 })
						},
						{ preconnect: () => {} },
					) satisfies typeof fetch
					const dependencies = makeDependencies({
						open: () => Effect.succeed(testSession.session),
						updateSession: recordStatuses(statuses),
						durableStreamFetch: holdFirstStreamPost,
						processEmittedEvent: () =>
							Effect.gen(function* () {
								const producer = yield* StreamProducer
								yield* producer.writeMessageStart()
							}),
					})
					yield* Effect.gen(function* () {
						const runner = yield* FoldSessionRunner
						const stale = yield* runner
							.runPrompt({ sessionId: sessionRow.id, prompt: 'stale' })
							.pipe(Effect.forkScoped)
						yield* Deferred.await(testSession.sendStarted)
						const resumed = yield* runner
							.runPrompt({ sessionId: sessionRow.id, prompt: 'resumed', admissionPolicy: 'recover-lost' })
							.pipe(Effect.forkScoped)
						yield* capture.awaitRecord({ claim_id: 'fold-claim-2', outcome: 'takeover_started' })
						yield* capture.awaitRecord({ claim_id: 'fold-claim-1', phase: 'terminal_projected' })
						const stalePost = yield* Queue.take(posts)
						expect(stalePost.signal?.aborted).toBe(false)
						yield* Effect.yieldNow
						yield* Effect.yieldNow

						// The stale prompt answered the interrupt, but its writer has not flushed.
						expect(yield* Ref.get(testSession.interrupts)).toBe(1)
						expect(
							capture.records.map((record) => [record.fields.claim_id, record.fields.phase]),
						).not.toContainEqual(['fold-claim-1', 'cleanup_completed'])
						expect(
							capture.records.map((record) => [record.fields.claim_id, record.fields.outcome]),
						).not.toContainEqual(['fold-claim-2', 'acquired'])
						expect(yield* Ref.get(statuses)).toEqual(['running'])
						expect(yield* Ref.get(testSession.sends)).toEqual(['stale'])

						stalePostResponse.resolve(
							new Response(null, { status: 200, headers: { 'stream-next-offset': '1' } }),
						)
						yield* capture.awaitRecord({ claim_id: 'fold-claim-1', phase: 'cleanup_completed' })
						yield* capture.awaitRecord({ claim_id: 'fold-claim-2', phase: 'provider_started' })
						yield* Fiber.join(stale)
						yield* Fiber.join(resumed)
					}).pipe(Effect.provide(makeRunnerLayer(dependencies)), Effect.provide(capture.loggerLayer))

					expect(yield* Ref.get(statuses)).toEqual(['running', 'running'])
					expect(yield* Ref.get(testSession.sends)).toEqual(['stale', 'resumed'])
					expect(
						ownershipFields(capture.records, [
							'session_id',
							'claim_id',
							'outcome',
							'phase',
							'prior_claim_id',
							'interrupt_outcome',
							'session_cache',
							'exit',
						]),
					).toEqual([
						{ session_id: sessionRow.id, claim_id: 'fold-claim-1', outcome: 'acquired' },
						{ session_id: sessionRow.id, claim_id: 'fold-claim-1', phase: 'provider_started' },
						{
							session_id: sessionRow.id,
							claim_id: 'fold-claim-2',
							outcome: 'takeover_started',
							prior_claim_id: 'fold-claim-1',
						},
						{ session_id: sessionRow.id, claim_id: 'fold-claim-1', phase: 'terminal_projected' },
						{
							session_id: sessionRow.id,
							claim_id: 'fold-claim-1',
							phase: 'cleanup_completed',
							exit: 'success',
						},
						{
							session_id: sessionRow.id,
							claim_id: 'fold-claim-2',
							outcome: 'takeover_completed',
							prior_claim_id: 'fold-claim-1',
							interrupt_outcome: 'graceful',
							session_cache: 'kept',
						},
						{
							session_id: sessionRow.id,
							claim_id: 'fold-claim-2',
							outcome: 'acquired',
							prior_claim_id: 'fold-claim-1',
						},
						{ session_id: sessionRow.id, claim_id: 'fold-claim-2', phase: 'provider_started' },
						{ session_id: sessionRow.id, claim_id: 'fold-claim-2', phase: 'terminal_projected' },
						{
							session_id: sessionRow.id,
							claim_id: 'fold-claim-2',
							phase: 'cleanup_completed',
							exit: 'success',
						},
					])
				}),
			),
		)

		it.effect('force-stops a stale prompt that ignores interrupt without writing a stale status', () =>
			Effect.scoped(
				Effect.gen(function* () {
					const capture = yield* makeFoldOwnershipRecordCapture()
					const stuckSendGate = yield* Deferred.make<void>()
					const stuckSession = yield* makeSession(stuckSendGate, undefined, 'ignores')
					const healthySession = yield* makeSession()
					const opens = yield* Ref.make(0)
					const statuses = yield* Ref.make<ReadonlyArray<string | undefined>>([])
					const dependencies = makeDependencies({
						open: () =>
							Ref.getAndUpdate(opens, (count) => count + 1).pipe(
								Effect.map((previousOpens) =>
									previousOpens === 0 ? stuckSession.session : healthySession.session,
								),
							),
						updateSession: recordStatuses(statuses),
					})
					yield* Effect.gen(function* () {
						const runner = yield* FoldSessionRunner
						const stale = yield* runner
							.runPrompt({ sessionId: sessionRow.id, prompt: 'stale' })
							.pipe(Effect.forkScoped)
						yield* Deferred.await(stuckSession.sendStarted)
						const resumed = yield* runner
							.runPrompt({ sessionId: sessionRow.id, prompt: 'resumed', admissionPolicy: 'recover-lost' })
							.pipe(Effect.forkScoped)
						yield* Deferred.await(stuckSession.interruptStarted)
						yield* Effect.yieldNow
						expect(yield* Ref.get(statuses)).toEqual(['running'])

						yield* TestClock.adjust('2 seconds')
						yield* Fiber.join(resumed)
						expect(Exit.hasInterrupts(yield* Fiber.await(stale))).toBe(true)
					}).pipe(Effect.provide(makeRunnerLayer(dependencies)), Effect.provide(capture.loggerLayer))

					// The forced stop reopens Fold from its durable log and never writes `interrupted`.
					expect(yield* Ref.get(opens)).toBe(2)
					expect(yield* Ref.get(statuses)).toEqual(['running', 'running'])
					expect(yield* Ref.get(stuckSession.sends)).toEqual(['stale'])
					expect(yield* Ref.get(healthySession.sends)).toEqual(['resumed'])
					// The stale claim never projected a terminal event; its cleanup ends interrupted.
					expect(
						ownershipFields(capture.records, [
							'session_id',
							'claim_id',
							'outcome',
							'phase',
							'prior_claim_id',
							'wait_ms',
							'interrupt_outcome',
							'session_cache',
							'exit',
						]),
					).toEqual([
						{ session_id: sessionRow.id, claim_id: 'fold-claim-1', outcome: 'acquired', wait_ms: 0 },
						{ session_id: sessionRow.id, claim_id: 'fold-claim-1', phase: 'provider_started' },
						{
							session_id: sessionRow.id,
							claim_id: 'fold-claim-2',
							outcome: 'takeover_started',
							prior_claim_id: 'fold-claim-1',
						},
						{
							session_id: sessionRow.id,
							claim_id: 'fold-claim-1',
							phase: 'cleanup_completed',
							exit: 'interrupted',
						},
						{
							session_id: sessionRow.id,
							claim_id: 'fold-claim-2',
							outcome: 'takeover_completed',
							prior_claim_id: 'fold-claim-1',
							wait_ms: 2000,
							interrupt_outcome: 'forced',
							session_cache: 'dropped',
						},
						{
							session_id: sessionRow.id,
							claim_id: 'fold-claim-2',
							outcome: 'acquired',
							prior_claim_id: 'fold-claim-1',
							wait_ms: 2000,
						},
						{ session_id: sessionRow.id, claim_id: 'fold-claim-2', phase: 'provider_started' },
						{ session_id: sessionRow.id, claim_id: 'fold-claim-2', phase: 'terminal_projected' },
						{
							session_id: sessionRow.id,
							claim_id: 'fold-claim-2',
							phase: 'cleanup_completed',
							exit: 'success',
						},
					])
				}),
			),
		)

		it.effect('force-stops a stale prompt whose Fold session is still opening', () =>
			Effect.scoped(
				Effect.gen(function* () {
					const healthySession = yield* makeSession()
					const opens = yield* Ref.make(0)
					const staleOpenStarted = yield* Deferred.make<void>()
					const statuses = yield* Ref.make<ReadonlyArray<string | undefined>>([])
					const dependencies = makeDependencies({
						open: () =>
							Ref.getAndUpdate(opens, (count) => count + 1).pipe(
								Effect.flatMap((previousOpens) =>
									previousOpens === 0
										? Deferred.succeed(staleOpenStarted, void 0).pipe(Effect.andThen(Effect.never))
										: Effect.succeed(healthySession.session),
								),
							),
						updateSession: recordStatuses(statuses),
					})
					yield* Effect.gen(function* () {
						const runner = yield* FoldSessionRunner
						const stale = yield* runner
							.runPrompt({ sessionId: sessionRow.id, prompt: 'stale' })
							.pipe(Effect.forkScoped)
						yield* Deferred.await(staleOpenStarted)
						const resumed = yield* runner
							.runPrompt({ sessionId: sessionRow.id, prompt: 'resumed', admissionPolicy: 'recover-lost' })
							.pipe(Effect.forkScoped)
						yield* Effect.yieldNow
						yield* Effect.yieldNow

						yield* TestClock.adjust('2 seconds')
						yield* Fiber.join(resumed)
						expect(Exit.hasInterrupts(yield* Fiber.await(stale))).toBe(true)
					}).pipe(Effect.provide(makeRunnerLayer(dependencies)))

					expect(yield* Ref.get(opens)).toBe(2)
					expect(yield* Ref.get(statuses)).toEqual(['running'])
					expect(yield* Ref.get(healthySession.sends)).toEqual(['resumed'])
				}),
			),
		)

		it.effect('fails with a typed error when the stale prompt cannot be stopped', () =>
			Effect.scoped(
				Effect.gen(function* () {
					const capture = yield* makeFoldOwnershipRecordCapture()
					const stuckSendGate = yield* Deferred.make<void>()
					const stuckSession = yield* makeSession(stuckSendGate, undefined, 'resists')
					const opens = yield* Ref.make(0)
					const statuses = yield* Ref.make<ReadonlyArray<string | undefined>>([])
					const dependencies = makeDependencies({
						open: () => Ref.update(opens, (count) => count + 1).pipe(Effect.as(stuckSession.session)),
						updateSession: recordStatuses(statuses),
					})
					yield* Effect.gen(function* () {
						const runner = yield* FoldSessionRunner
						const stale = yield* runner
							.runPrompt({ sessionId: sessionRow.id, prompt: 'stale' })
							.pipe(Effect.forkScoped)
						yield* Deferred.await(stuckSession.sendStarted)
						const resumed = yield* runner
							.runPrompt({ sessionId: sessionRow.id, prompt: 'resumed', admissionPolicy: 'recover-lost' })
							.pipe(Effect.forkScoped)
						yield* Deferred.await(stuckSession.interruptStarted)
						yield* Effect.yieldNow

						yield* TestClock.adjust('30 seconds')
						const error = yield* Fiber.join(resumed).pipe(Effect.flip)
						expect(error).toBeInstanceOf(FoldPromptTakeoverError)
						expect(error).toMatchObject({ sessionId: sessionRow.id, staleClaimId: 'fold-claim-1' })

						yield* Deferred.succeed(stuckSendGate, void 0)
						expect(Exit.hasInterrupts(yield* Fiber.await(stale))).toBe(true)
					}).pipe(Effect.provide(makeRunnerLayer(dependencies)), Effect.provide(capture.loggerLayer))

					const replacementRecords = capture.records.filter(
						(record) => record.fields.claim_id === 'fold-claim-2',
					)
					expect(replacementRecords.map((record) => [record.level, record.fields])).toEqual([
						[
							'INFO',
							{
								session_id: sessionRow.id,
								claim_id: 'fold-claim-2',
								outcome: 'takeover_started',
								prior_claim_id: 'fold-claim-1',
							},
						],
						[
							'ERROR',
							expect.objectContaining({
								session_id: sessionRow.id,
								claim_id: 'fold-claim-2',
								outcome: 'takeover_failed',
								prior_claim_id: 'fold-claim-1',
								wait_ms: 30000,
							}),
						],
					])

					expect(yield* Ref.get(opens)).toBe(1)
					expect(yield* Ref.get(statuses)).toEqual(['running'])
					expect(yield* Ref.get(stuckSession.sends)).toEqual(['stale'])
				}),
			),
		)

		it.effect('takes over only the stale owner and serializes behind newer prompts', () =>
			Effect.scoped(
				Effect.gen(function* () {
					const staleSendGate = yield* Deferred.make<void>()
					const testSession = yield* makeSession(staleSendGate)
					const dependencies = makeDependencies({ open: () => Effect.succeed(testSession.session) })
					yield* Effect.gen(function* () {
						const runner = yield* FoldSessionRunner
						const stale = yield* runner
							.runPrompt({ sessionId: sessionRow.id, prompt: 'stale' })
							.pipe(Effect.forkScoped)
						yield* Deferred.await(testSession.sendStarted)
						const queued = yield* runner
							.runPrompt({ sessionId: sessionRow.id, prompt: 'queued' })
							.pipe(Effect.forkScoped)
						const resumed = yield* runner
							.runPrompt({ sessionId: sessionRow.id, prompt: 'resumed', admissionPolicy: 'recover-lost' })
							.pipe(Effect.forkScoped)
						yield* Fiber.join(stale)
						yield* Fiber.join(queued)
						yield* Fiber.join(resumed)
					}).pipe(Effect.provide(makeRunnerLayer(dependencies)))

					const sends = yield* Ref.get(testSession.sends)
					expect(sends[0]).toBe('stale')
					expect([...sends.slice(1)].sort()).toEqual(['queued', 'resumed'])
					expect(yield* Ref.get(testSession.interrupts)).toBe(1)
				}),
			),
		)
	})
})
