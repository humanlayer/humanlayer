import { runtimeForAgent } from '@humanlayer/fold-core'
import type {
	AgentFinishedLogEntry,
	CompactionLogEntry,
	ErrorLogEntry,
	FoldSession,
	LogEntry,
	SessionStartedLogEntry,
} from '@humanlayer/fold-core'
import * as Sentry from '@sentry/bun'
import {
	Cause,
	Clock,
	Config,
	Data,
	Deferred,
	Duration,
	Effect,
	Exit,
	Fiber,
	Layer,
	Match,
	Option,
	Predicate,
	RcMap,
	Ref,
	Schema,
	Scope,
	Stream,
} from 'effect'

import { isInterruptRequestedEvent } from '@/agents/claudecode/interrupts'
import { normalizePath } from '@/lib/utils'

import { DaemonApi } from '../daemon-api/daemon-api.service'
import { DaemonCollections } from '../daemon-collections/daemon-collections.service'
import { DurableStreamFetch } from '../stream-producer/durable-stream-fetch'
import { StreamProducerLiveForSession } from '../stream-producer/stream-producer.service'
import { FoldEventProcessor } from './fold-event-processor.service'
import type { FoldHostServices } from './fold-host-services'
import { makeFoldModel } from './fold-model-selection'
import { parseFoldPromptCommand } from './fold-prompt-command'
import { describeFoldPromptFailure } from './fold-session-error-message'
import { FoldSessionOpener } from './fold-session-opener.service'
import { FoldSessionRunner } from './fold-session-runner.service'
import {
	FoldPromptRunError,
	FoldPromptTakeoverError,
	FoldSessionIdentityUnavailableError,
	FoldSessionsShuttingDownError,
} from './fold-sessions.errors'
import {
	type FoldPromptAdmissionPolicy,
	FoldModelSelection,
	FoldSessionIdentity,
	type RunFoldPromptInput,
} from './fold-sessions.schemas'

const isCompactionFailureAfter =
	(lastSeq: number) =>
	(entry: LogEntry): entry is ErrorLogEntry =>
		Predicate.isTagged(entry, 'error') && entry.seq > lastSeq && entry.errorType === 'compaction'

type PromptFiber = Fiber.Fiber<void, FoldPromptRunError>

/** One prompt's exclusive ownership of a Fold session. Compared by reference; `id` is for logs. */
interface PromptInFlight {
	readonly id: string
	/** Completes after the prompt scope, its finalizers, and claim release (in that order). */
	readonly done: Deferred.Deferred<void>
	/** The opened Fold session; null while the session is still opening. */
	readonly session: Ref.Ref<FoldSession<FoldHostServices> | null>
	/** Completes as soon as the prompt fiber exists, so every installed claim can be stopped. */
	readonly fiberReady: Deferred.Deferred<PromptFiber>
}

/** How a claim stopped: Fold finished within the interrupt deadline, or its fiber was interrupted. */
type ClaimStopOutcome = 'graceful' | 'forced'

/**
 * A user or shutdown interrupt writes `interrupted` itself when Fold misses the deadline. A
 * lost-session takeover must not, because that write would land on top of the newer `resuming`.
 */
type ForcedStopStatusPolicy = 'report-interrupted' | 'leave-status'

/**
 * Structured log records for Fold prompt ownership. Every record carries the session ID because
 * claim IDs come from a per-runner counter that restarts with the daemon.
 */
type FoldPromptAdmissionOutcome = 'acquired' | 'waiting' | 'takeover_started' | 'takeover_completed' | 'takeover_failed'

interface FoldPromptAdmissionRecord {
	readonly sessionId: string
	readonly claimId: string
	readonly outcome: FoldPromptAdmissionOutcome
	/** The claim this prompt waited behind or took over. */
	readonly priorClaimId?: string | undefined
	readonly waitMs?: number
	readonly interruptOutcome?: ClaimStopOutcome
	/** Whether a takeover dropped the cached Fold session so the replacement reopens it. */
	readonly sessionCache?: 'kept' | 'dropped'
}

/** The `fold_prompt_admission` annotations; absent fields are omitted rather than logged as undefined. */
type FoldPromptAdmissionLogFields = {
	session_id: string
	claim_id: string
	outcome: FoldPromptAdmissionOutcome
	prior_claim_id?: string
	wait_ms?: number
	interrupt_outcome?: ClaimStopOutcome
	session_cache?: 'kept' | 'dropped'
}

const logFoldPromptAdmission = (record: FoldPromptAdmissionRecord) => {
	const fields: FoldPromptAdmissionLogFields = {
		session_id: record.sessionId,
		claim_id: record.claimId,
		outcome: record.outcome,
	}
	if (record.priorClaimId !== undefined) fields.prior_claim_id = record.priorClaimId
	if (record.waitMs !== undefined) fields.wait_ms = record.waitMs
	if (record.interruptOutcome !== undefined) fields.interrupt_outcome = record.interruptOutcome
	if (record.sessionCache !== undefined) fields.session_cache = record.sessionCache
	const log = record.outcome === 'takeover_failed' ? Effect.logError : Effect.logInfo
	return log('fold_prompt_admission').pipe(Effect.annotateLogs(fields))
}

type FoldPromptLifecyclePhase = 'provider_started' | 'terminal_projected' | 'cleanup_completed'

type FoldPromptExitKind = 'success' | 'failure' | 'interrupted'

const foldPromptExitKind = (exit: Exit.Exit<unknown, unknown>): FoldPromptExitKind =>
	Exit.isSuccess(exit) ? 'success' : Cause.hasInterruptsOnly(exit.cause) ? 'interrupted' : 'failure'

/** The `fold_prompt_lifecycle` annotations. `elapsed_ms` counts from claim acquisition. */
type FoldPromptLifecycleLogFields = {
	session_id: string
	claim_id: string
	phase: FoldPromptLifecyclePhase
	elapsed_ms: number
	exit?: FoldPromptExitKind
}

const logFoldPromptLifecycle = Effect.fnUntraced(function* (record: {
	readonly sessionId: string
	readonly claimId: string
	readonly phase: FoldPromptLifecyclePhase
	readonly acquiredAtMillis: number
	readonly exit?: FoldPromptExitKind
}) {
	const now = yield* Clock.currentTimeMillis
	const fields: FoldPromptLifecycleLogFields = {
		session_id: record.sessionId,
		claim_id: record.claimId,
		phase: record.phase,
		elapsed_ms: now - record.acquiredAtMillis,
	}
	if (record.exit !== undefined) fields.exit = record.exit
	yield* Effect.logInfo('fold_prompt_lifecycle').pipe(Effect.annotateLogs(fields))
})

interface RunnerState {
	readonly shuttingDown: boolean
	readonly inFlight: ReadonlyMap<string, PromptInFlight>
}

const identityFromSession = (row: {
	readonly id: string
	readonly organization_id: string | null
	readonly host_id: string
	readonly task_id: string | null
	readonly working_directory: string
}) =>
	row.organization_id === null
		? null
		: {
				sessionId: row.id,
				organizationId: row.organization_id,
				hostId: row.host_id,
				taskId: row.task_id,
				workingDirectory: normalizePath(row.working_directory),
			}

type RunDecision = Data.TaggedEnum<{
	Shutdown: Record<never, never>
	Wait: { readonly existing: PromptInFlight }
	TakeOver: { readonly existing: PromptInFlight }
	Run: Record<never, never>
}>
const RunDecision = Data.taggedEnum<RunDecision>()

const isSessionStartedEntry = (entry: LogEntry): entry is SessionStartedLogEntry =>
	Predicate.isTagged('session_started')(entry)
const isAgentFinishedEntry = (entry: LogEntry): entry is AgentFinishedLogEntry =>
	Predicate.isTagged('agent-finished')(entry)
const isCompactionEntry = (entry: LogEntry): entry is CompactionLogEntry => Predicate.isTagged('compaction')(entry)
const isCompactCommand = Predicate.isTagged('Compact')

type FoldSessionWithGuidedCompaction = Omit<FoldSession<FoldHostServices>, 'compact'> & {
	readonly compact: (options?: {
		readonly additionalInstructions?: string | null
	}) => Effect.Effect<CompactionLogEntry | null>
}

export const FoldSessionRunnerLive = Layer.effect(
	FoldSessionRunner,
	Effect.gen(function* () {
		const opener = yield* FoldSessionOpener
		const processor = yield* FoldEventProcessor
		const api = yield* DaemonApi
		const collectionsService = yield* DaemonCollections
		const durableStreamFetch = yield* DurableStreamFetch
		const runnerScope = yield* Scope.Scope
		const idleTimeToLive = yield* Config.Duration('RIPTIDE_FOLD_SESSION_IDLE_TTL').pipe(
			Config.withDefault(Duration.minutes(10)),
		)
		const interruptDeadline = yield* Config.Duration('RIPTIDE_FOLD_INTERRUPT_DEADLINE').pipe(
			Config.withDefault(Duration.seconds(2)),
		)
		// Bounds the whole lost-session takeover: graceful interrupt, forced interrupt, and cleanup.
		const takeoverDeadline = yield* Config.Duration('RIPTIDE_FOLD_TAKEOVER_DEADLINE').pipe(
			Config.withDefault(Duration.seconds(30)),
		)
		const claimSequence = yield* Ref.make(0)
		const sessions = yield* RcMap.make({
			lookup: (sessionId: string) => opener.open({ sessionId }),
			idleTimeToLive,
		})
		const state = yield* Ref.make<RunnerState>({ shuttingDown: false, inFlight: new Map() })

		const captureFailure = (sessionId: string, cause: Cause.Cause<unknown>, operation: string) =>
			Effect.logError('Fold session operation failed', cause).pipe(
				Effect.annotateLogs({ sessionId, operation }),
				Effect.andThen(
					Effect.sync(() =>
						Sentry.captureException(Cause.squash(cause), {
							tags: { error_type: 'fold_prompt_failed', session_id: sessionId, operation },
							extra: { cause: Cause.pretty(cause) },
						}),
					),
				),
			)
		const updateSessionBestEffort = (sessionId: string, update: Parameters<typeof api.updateSession>[0]) =>
			api.updateSession(update).pipe(
				Effect.retry({ times: 2 }),
				Effect.catchCause((cause) => captureFailure(sessionId, cause, 'updateSession')),
			)

		const runClaimedPrompt = (input: RunFoldPromptInput, claim: PromptInFlight, acquiredAtMillis: number) => {
			const lifecycle = { sessionId: input.sessionId, claimId: claim.id, acquiredAtMillis }
			return Effect.scoped(
				Effect.gen(function* () {
					const command = parseFoldPromptCommand(input.prompt)
					const session = yield* RcMap.get(sessions, input.sessionId)
					yield* Ref.set(claim.session, session)
					// Opening/resuming can take time; sample settings after acquisition, not before it.
					const collections = yield* collectionsService.current
					const row = collections.sessions.get(input.sessionId)
					const identityInput = row === undefined ? null : identityFromSession(row)
					if (identityInput === null)
						return yield* new FoldSessionIdentityUnavailableError({ sessionId: input.sessionId })
					const identity = yield* Schema.decodeUnknownEffect(FoldSessionIdentity)(identityInput)
					const modelSelection = yield* Schema.decodeUnknownEffect(FoldModelSelection)({
						provider: row?.provider,
						model: row?.model,
						reasoning: row?.effort ?? 'low',
					})
					const configuredModel = yield* makeFoldModel(modelSelection)
					const currentRuntime = runtimeForAgent(yield* session.entries, session.rootAgentId)
					if (
						currentRuntime.activeModel?.providerId !== configuredModel.activeModel.providerId ||
						currentRuntime.activeModel?.modelId !== configuredModel.activeModel.modelId ||
						currentRuntime.reasoningLevel !== modelSelection.reasoning
					) {
						// Only reconcile between prompts. Keep the warm session and its registered subagents.
						yield* session.switchModel(configuredModel).pipe(Effect.withSpan('fold.reconcileRootModel'))
					}
					const controls = yield* collectionsService.streamSessionChanges(input.sessionId).pipe(
						Stream.runForEach((change) => {
							if (isInterruptRequestedEvent(change, input.sessionId)) return session.interrupt()
							const archived = change.type !== 'delete' && change.value.archived
							return archived ? RcMap.invalidate(sessions, input.sessionId) : Effect.void
						}),
						Effect.forkScoped({ startImmediately: true }),
					)
					const entries = yield* session.entries
					// One prompt-owned prefix, seeded from the durable log on both warm reuse and resume.
					// Append in stream order, never read the live head when pricing an earlier event.
					const history: LogEntry[] = [...entries]
					const started = entries.find(isSessionStartedEntry)
					if (started !== undefined && row?.coding_agent_session_id !== started.sessionId) {
						yield* api
							.updateSession({ sessionId: input.sessionId, codingAgentSessionId: started.sessionId })
							.pipe(Effect.retry({ times: 2 }))
					}
					const reader = yield* session.events(entries.length).pipe(
						Stream.tap((event) => {
							if (event.kind === 'log') history.push(event.entry)
							return processor.processEmittedEvent({
								identity,
								history,
								rootAgentId: session.rootAgentId,
								event,
							})
						}),
						Stream.takeUntil((event) => {
							if (event.kind !== 'log') return false
							if (event.entry.agentId !== session.rootAgentId) return false
							return isCompactCommand(command)
								? isCompactionEntry(event.entry)
								: isAgentFinishedEntry(event.entry)
						}),
						Stream.runDrain,
						Effect.forkScoped({ startImmediately: true }),
					)
					yield* Effect.yieldNow
					yield* api
						.updateSession({ sessionId: input.sessionId, status: 'running' })
						.pipe(Effect.retry({ times: 2 }))
					yield* logFoldPromptLifecycle({ ...lifecycle, phase: 'provider_started' })
					if (isCompactCommand(command)) {
						const compactableSession = session as FoldSessionWithGuidedCompaction
						const entriesBeforeCompaction = yield* session.entries
						const lastSeqBeforeCompaction = entriesBeforeCompaction.at(-1)?.seq ?? -1
						const compacted = yield* compactableSession.compact(
							command.additionalInstructions === null
								? undefined
								: { additionalInstructions: command.additionalInstructions },
						)
						if (compacted === null) {
							yield* Fiber.interrupt(reader)
							const entriesAfterCompaction = yield* session.entries
							const compactionFailure = entriesAfterCompaction.find(
								isCompactionFailureAfter(lastSeqBeforeCompaction),
							)
							if (compactionFailure !== undefined) return yield* Effect.die(compactionFailure.message)
						} else yield* Fiber.join(reader)
						yield* api
							.updateSession({ sessionId: input.sessionId, status: 'ready_for_input' })
							.pipe(Effect.retry({ times: 2 }))
					} else {
						yield* session.send(command.prompt)
						yield* Fiber.join(reader)
					}
					yield* logFoldPromptLifecycle({ ...lifecycle, phase: 'terminal_projected' })
					yield* Fiber.interrupt(controls)
				}).pipe(
					Effect.provide(
						StreamProducerLiveForSession({ sessionId: input.sessionId }).pipe(
							Layer.provide(
								Layer.mergeAll(
									Layer.succeed(DaemonApi, api),
									Layer.succeed(DurableStreamFetch, durableStreamFetch),
								),
							),
						),
					),
				),
			).pipe(
				Effect.catchCause((cause) =>
					Cause.hasInterruptsOnly(cause)
						? Effect.interrupt
						: Effect.suspend(() => {
								const message = describeFoldPromptFailure(cause)
								return captureFailure(input.sessionId, cause, 'runPrompt').pipe(
									Effect.andThen(
										updateSessionBestEffort(input.sessionId, {
											sessionId: input.sessionId,
											status: 'failed',
											errorMessage: message,
										}),
									),
									Effect.andThen(
										Effect.fail(
											new FoldPromptRunError({
												sessionId: input.sessionId,
												cause,
												message,
											}),
										),
									),
								)
							}),
				),
				// Runs after the prompt scope closed, so the durable writer has flushed and detached.
				// Release the claim before completing `done`: a woken waiter must not find this
				// finished claim still installed and spin on its completed `done`.
				Effect.onExit((exit) =>
					logFoldPromptLifecycle({
						...lifecycle,
						phase: 'cleanup_completed',
						exit: foldPromptExitKind(exit),
					}).pipe(
						Effect.andThen(
							Ref.update(state, (current) => {
								const inFlight = new Map(current.inFlight)
								if (inFlight.get(input.sessionId) === claim) inFlight.delete(input.sessionId)
								return { ...current, inFlight }
							}),
						),
						Effect.andThen(Deferred.succeed(claim.done, void 0)),
					),
				),
			)
		}

		const makeClaim = Effect.gen(function* () {
			const sequence = yield* Ref.updateAndGet(claimSequence, (current) => current + 1)
			return {
				id: `fold-claim-${sequence}`,
				done: yield* Deferred.make<void>(),
				session: yield* Ref.make<FoldSession<FoldHostServices> | null>(null),
				fiberReady: yield* Deferred.make<PromptFiber>(),
			} satisfies PromptInFlight
		})

		/**
		 * Stop the exact claim the caller captured, never whatever owns the session now. Ask Fold to
		 * interrupt, then interrupt the prompt fiber if Fold misses the deadline. Returns only after
		 * the claim's scope, finalizers, and release have finished.
		 */
		const stopCapturedClaim = Effect.fn('fold.stopCapturedClaim')(function* (input: {
			readonly sessionId: string
			readonly claim: PromptInFlight
			readonly forcedStopStatus: ForcedStopStatusPolicy
		}) {
			const promptFiber = yield* Deferred.await(input.claim.fiberReady)
			const session = yield* Ref.get(input.claim.session)
			if (session !== null) yield* session.interrupt()
			const stoppedGracefully = yield* Fiber.await(promptFiber).pipe(Effect.timeoutOption(interruptDeadline))
			if (Option.isSome(stoppedGracefully)) {
				yield* Deferred.await(input.claim.done)
				return 'graceful' satisfies ClaimStopOutcome
			}
			yield* Fiber.interrupt(promptFiber)
			yield* Deferred.await(input.claim.done)
			if (input.forcedStopStatus === 'report-interrupted') {
				yield* updateSessionBestEffort(input.sessionId, { sessionId: input.sessionId, status: 'interrupted' })
			}
			return 'forced' satisfies ClaimStopOutcome
		})

		/**
		 * Replace a prompt the database already declared lost. Leaves the session status alone: the
		 * stale prompt may still project its own terminal event, and the replacement reports `running`
		 * once it owns the session.
		 */
		const takeOverStaleClaim = Effect.fn('fold.takeOverStaleClaim')(function* (input: {
			readonly sessionId: string
			/** The replacement prompt's claim, for log correlation only. */
			readonly claimId: string
			readonly staleClaim: PromptInFlight
		}) {
			const record = { sessionId: input.sessionId, claimId: input.claimId, priorClaimId: input.staleClaim.id }
			const startedAtMillis = yield* Clock.currentTimeMillis
			yield* logFoldPromptAdmission({ ...record, outcome: 'takeover_started' })
			const outcome = yield* Effect.gen(function* () {
				const stopOutcome = yield* stopCapturedClaim({
					sessionId: input.sessionId,
					claim: input.staleClaim,
					forcedStopStatus: 'leave-status',
				})
				// A forced stop can leave the warm Fold session mid-turn or its open still pending.
				// Drop it so the replacement reopens from the durable Fold log.
				if (stopOutcome === 'forced') yield* RcMap.invalidate(sessions, input.sessionId)
				return stopOutcome
			}).pipe(Effect.timeoutOption(takeoverDeadline))
			const waitMs = (yield* Clock.currentTimeMillis) - startedAtMillis
			if (Option.isSome(outcome)) {
				yield* logFoldPromptAdmission({
					...record,
					outcome: 'takeover_completed',
					waitMs,
					interruptOutcome: outcome.value,
					sessionCache: outcome.value === 'forced' ? 'dropped' : 'kept',
				})
				return outcome.value
			}
			yield* logFoldPromptAdmission({ ...record, outcome: 'takeover_failed', waitMs })
			const error = new FoldPromptTakeoverError({
				sessionId: input.sessionId,
				staleClaimId: input.staleClaim.id,
				message: `Could not resume the session: its previous run did not stop within ${Duration.format(takeoverDeadline)}. Restart the daemon, then resume again.`,
			})
			yield* captureFailure(input.sessionId, Cause.fail(error), 'takeOverStaleClaim')
			return yield* error
		})

		const runPrompt: typeof FoldSessionRunner.Service.runPrompt = Effect.fn('fold.runPrompt')(function* (
			input: RunFoldPromptInput,
		) {
			// Recovery replaces only the stale owner seen at admission. After one takeover the prompt
			// serializes, so it never interrupts an owner admitted after the session was lost.
			let admissionPolicy: FoldPromptAdmissionPolicy = input.admissionPolicy ?? 'serialize'
			// One claim per prompt, installed only on `Run`, so its ID follows the prompt across retries.
			const claim = yield* makeClaim
			const admissionStartedAtMillis = yield* Clock.currentTimeMillis
			let priorClaimId: string | undefined
			const elapsedSinceAdmission = Clock.currentTimeMillis.pipe(
				Effect.map((now) => now - admissionStartedAtMillis),
			)
			while (true) {
				// Install the claim and fork its fiber without an interruption gap, so no claim can exist
				// without a fiber that a stopper can await or interrupt.
				const admittedFiber = yield* Effect.uninterruptibleMask((restore) =>
					Effect.gen(function* () {
						const decision = yield* Ref.modify<RunnerState, RunDecision>(state, (current) => {
							if (current.shuttingDown) return [RunDecision.Shutdown(), current]
							const existing = current.inFlight.get(input.sessionId)
							if (existing !== undefined)
								return [
									admissionPolicy === 'recover-lost'
										? RunDecision.TakeOver({ existing })
										: RunDecision.Wait({ existing }),
									current,
								]
							const inFlight = new Map(current.inFlight).set(input.sessionId, claim)
							return [RunDecision.Run(), { ...current, inFlight }]
						})
						return yield* Match.value(decision).pipe(
							Match.tagsExhaustive({
								Shutdown: () =>
									Effect.fail(
										new FoldSessionsShuttingDownError({
											sessionId: input.sessionId,
											message: 'Fold sessions are shutting down.',
										}),
									),
								Wait: ({ existing }) =>
									Effect.gen(function* () {
										priorClaimId = existing.id
										yield* logFoldPromptAdmission({
											sessionId: input.sessionId,
											claimId: claim.id,
											outcome: 'waiting',
											priorClaimId: existing.id,
											waitMs: yield* elapsedSinceAdmission,
										})
										yield* restore(Deferred.await(existing.done))
										return Option.none<PromptFiber>()
									}),
								TakeOver: ({ existing }) =>
									restore(
										takeOverStaleClaim({
											sessionId: input.sessionId,
											claimId: claim.id,
											staleClaim: existing,
										}),
									).pipe(
										Effect.tap(() =>
											Effect.sync(() => {
												admissionPolicy = 'serialize'
												priorClaimId = existing.id
											}),
										),
										Effect.as(Option.none<PromptFiber>()),
									),
								Run: () =>
									Effect.gen(function* () {
										const acquiredAtMillis = yield* Clock.currentTimeMillis
										yield* logFoldPromptAdmission({
											sessionId: input.sessionId,
											claimId: claim.id,
											outcome: 'acquired',
											priorClaimId,
											waitMs: acquiredAtMillis - admissionStartedAtMillis,
										})
										const promptFiber = yield* Effect.forkIn(
											runClaimedPrompt(input, claim, acquiredAtMillis),
											runnerScope,
										)
										yield* Deferred.succeed(claim.fiberReady, promptFiber)
										return Option.some(promptFiber)
									}),
							}),
						)
					}),
				)
				if (Option.isNone(admittedFiber)) continue
				yield* Fiber.join(admittedFiber.value)
				return
			}
		})

		const interruptSession = Effect.fn('fold.interruptSession')(function* (input: { readonly sessionId: string }) {
			const current = yield* Ref.get(state)
			const active = current.inFlight.get(input.sessionId)
			if (active === undefined) return 'not-running' as const
			const outcome = yield* stopCapturedClaim({
				sessionId: input.sessionId,
				claim: active,
				forcedStopStatus: 'report-interrupted',
			})
			return outcome === 'graceful' ? ('stopped' as const) : ('timed-out' as const)
		})
		const shutdownActiveSessions = Effect.gen(function* () {
			const active = yield* Ref.modify(state, (current) => [
				[...current.inFlight.keys()],
				{ ...current, shuttingDown: true },
			])
			yield* Effect.forEach(active, (sessionId) => interruptSession({ sessionId }), {
				concurrency: 8,
				discard: true,
			})
		}).pipe(Effect.withSpan('fold.shutdownActiveSessions'))

		const activeSessionIds = Ref.get(state).pipe(Effect.map((current) => [...current.inFlight.keys()]))

		return { runPrompt, interruptSession, shutdownActiveSessions, activeSessionIds }
	}),
)
