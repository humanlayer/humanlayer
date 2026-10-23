import { sessionSelectSchema, type SessionRow } from '@humanlayer/db/tables/sessions'
import { FoldForkMetadataSchema } from '@humanlayer/riptide-api-contract/api/sessions/fork'
import type { CodingAgent } from '@humanlayer/schemas/coding-agent'
import { Cause, Effect } from 'effect'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import type z from 'zod/v4'

import { Sentry } from '@/instrument'
import { describeUnknownError } from '@/lib/safe-error-display'
import logger from '@/logger'

import type { DaemonServices } from '../claudecode/types'
import { createInterruptState, type InterruptStateService } from './interrupt-state.service'

export type { InterruptStateService }

export type SessionForExecution = Omit<SessionRow, 'fork_data'> & { fork_data: unknown }

/**
 * Electric collection values include TanStack virtual fields and arrive from a
 * network boundary. Parse the persisted session fields before dispatching an
 * agent executor that requires the database session model.
 */
export function parseSessionForExecution(value: unknown): SessionForExecution | null {
	const result = sessionSelectSchema.safeParse(value)
	return result.success ? result.data : null
}

/**
 * Extracts a human-readable error message from various error types,
 * including Effect's wrapped errors (FiberFailure, Cause, etc.)
 */
const CauseCarrier = Schema.Struct({ cause: Schema.Unknown })

function extractErrorMessage(error: unknown): string {
	const cause = Option.getOrUndefined(Schema.decodeUnknownOption(CauseCarrier)(error))?.cause
	if (Cause.isCause(cause)) {
		const failure = cause.reasons.find(Cause.isFailReason)?.error
		if (failure !== undefined) return describeUnknownError(failure)
	}
	return describeUnknownError(error)
}

/**
 * Why a session run started. `lost-resume` means the synchronized row moved from `lost` to
 * `resuming`, so a provider may replace process-local work the database already declared stale.
 * Every other run, including launches, is `ordinary`.
 */
export type SessionContinuationKind = 'ordinary' | 'lost-resume'

export interface SessionContext {
	session: SessionForExecution
	services: DaemonServices
	interruptState: InterruptStateService
	/** Omitted means `ordinary`. */
	continuationKind?: SessionContinuationKind
}

export type SessionExecutor = (ctx: SessionContext, resumeSessionId?: string, forkMeta?: ForkMeta) => Promise<void>

export interface RunSessionOptions {
	session: SessionForExecution
	services: DaemonServices
	resumeSessionId?: string
	forkMeta?: NormalizedForkMeta
	/** Defaults to `ordinary`. */
	continuationKind?: SessionContinuationKind
	execute: SessionExecutor
}

export type ClaudeForkMeta = {
	agent: Extract<CodingAgent, 'claude'>
	forkFromCodingAgentSessionId: string
	forkAtCodingAgentEventId: string
}

export type CodelayerForkMeta = {
	agent: Extract<CodingAgent, 'codelayer'>
	sourceSessionId: string
	forkAtEventId: string
	forkAtRunIndex: number
	sourceSnapshotRunIndex: number
}

export type FoldForkMeta = z.infer<typeof FoldForkMetadataSchema>

export type NormalizedForkMeta = ClaudeForkMeta | CodelayerForkMeta | FoldForkMeta
export type ForkMeta = NormalizedForkMeta

/**
 * Shared post-run hook: PR capture. Fire-and-forget from `runSession`'s finally — it runs
 * AFTER shutdown coordination and must never throw or gate shutdown. Commit capture is no
 * longer here: the continuous commit HEAD-watch (`startCommitWatcher`) owns it now, so it
 * catches human-made and post-run commits the old run-window scan structurally missed.
 */
async function collectAndRecordPostRun(args: {
	session: SessionForExecution
	services: DaemonServices
}): Promise<void> {
	const { session, services } = args

	// The agent may have created its own branch during the run; the server links pull requests
	// through this session→repository record.
	await services.repositoryObserver?.observeSession(session.id)
}

export function startDetachedPostRunCapture(input: {
	readonly resolveSessionCompletion: () => void
	readonly capturePostRun: () => Promise<void>
	readonly captureUnexpectedFailure: (error: unknown) => void
}): void {
	input.resolveSessionCompletion()
	void input.capturePostRun().catch(input.captureUnexpectedFailure)
}

/**
 * Shared session lifecycle wrapper.
 * Handles shutdown registration, cleanup, and error handling.
 * Agent-specific logic lives in the `execute` callback.
 */
export async function runSession(opts: RunSessionOptions): Promise<void> {
	const { session, services, resumeSessionId, forkMeta, execute, continuationKind = 'ordinary' } = opts
	const sessionId = session.id

	// Register completion promise for shutdown coordination
	// This MUST be resolved before the function returns (in finally block)
	services.shutdown.registerSessionCompletion(sessionId)

	const interruptState = await createInterruptState()

	void services.repositoryObserver?.observeSession(sessionId)

	try {
		await execute({ session, services, interruptState, continuationKind }, resumeSessionId, forkMeta)
		logger.info(`Session ${sessionId} completed`)
	} catch (error) {
		const wasInterrupted = await Effect.runPromise(interruptState.wasInterrupted)
		if (!wasInterrupted) {
			logger.error({ sessionId, error }, 'Session failed')
			// Extract error message, handling Effect's error wrapping
			const errorMessage = extractErrorMessage(error)
			await services.orpc.sessions.update({
				sessionId,
				status: 'failed',
				errorMessage,
			})
		}
		throw error
	} finally {
		startDetachedPostRunCapture({
			resolveSessionCompletion: () => services.shutdown.resolveSessionCompletion(sessionId),
			capturePostRun: () => collectAndRecordPostRun({ session, services }),
			captureUnexpectedFailure: (error) => {
				logger.error({ sessionId, error }, 'Post-run hook failed unexpectedly')
				Sentry.captureException(error, {
					tags: { error_type: 'post_run_hook_unexpected', session_id: sessionId },
				})
			},
		})
	}
}
