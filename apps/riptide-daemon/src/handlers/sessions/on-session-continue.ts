import { LaunchableCodingAgentZodSchema } from '@humanlayer/schemas/coding-agent'
import { sessionCommand } from '@humanlayer/session-sdk-sessions'
import { Effect } from 'effect'

import type { DaemonServices } from '@/agents/claudecode/types'
import { parseSessionForExecution, runSession, type SessionContinuationKind } from '@/agents/shared/run-session'
import type { SessionChangeMessage } from '@/collections/types'
import { ClaudeSessions } from '@/effects/services/claude-sessions/claude-sessions.service'
import { foldAdmissionPolicyFor } from '@/effects/services/fold-sessions/fold-session-executor'
import logger from '@/logger'

/**
 * Determine if we should treat an event as a session continuation
 */
export function shouldContinueSession(change: SessionChangeMessage) {
	if (sessionCommand(change)?.kind !== 'continue') return false
	logger.info(
		`${change.type === 'insert' ? 'Insert' : 'Update'} for session ${change.value.id} synced with status resuming`,
	)
	return true
}

/**
 * Only a synchronized update carrying the prior row proves `lost → resuming`. An insert already in
 * `resuming` has no such evidence, so it stays an ordinary continuation.
 */
export function continuationKindFor(change: SessionChangeMessage): SessionContinuationKind {
	const command = sessionCommand(change)
	return command?.kind === 'continue' ? command.resume : 'ordinary'
}

/**
 * Handler for when a session should be continued.
 * Receives DaemonServices via dependency injection from subscriptions.ts.
 */
export async function handleContinueSession(change: SessionChangeMessage, services: DaemonServices) {
	const session = change.value
	if (services.automationTargetSessionId !== undefined && session.id !== services.automationTargetSessionId) return

	// Parse the agent against the set the daemon can actually run. Anything outside it — opencode
	// today — is rejected until its execution path lands. See
	// .humanlayer/tasks/putting-fold-in-humanlayer/06-structure-outline-fold-agent-platform.md.
	const launchableAgent = LaunchableCodingAgentZodSchema.safeParse(session.coding_agent)
	if (!launchableAgent.success) {
		logger.error(
			`Coding agent ${session.coding_agent} is not supported for continuing sessions yet (session ${session.id})`,
		)
		await services.orpc.sessions.update({
			sessionId: session.id,
			status: 'failed',
			errorMessage: `The ${session.coding_agent} coding agent is not currently supported.`,
		})
		return
	}

	// Claude resumes through its provider session ID. CodeLayer and Fold resume from Riptide-owned state.
	if (launchableAgent.data !== 'codelayer' && launchableAgent.data !== 'fold' && !session.coding_agent_session_id) {
		logger.error(`Unable to continue session ${session.id} - no coding_agent_session_id is available`)
		await services.orpc.sessions.update({
			sessionId: session.id,
			status: 'failed',
			errorMessage: 'Unable to locate coding agent session ID.',
			errorReason: 'start_failed',
		})
		return
	}

	const markSessionRunningBeforeDelivery = async () => {
		await services.orpc.sessions.update({
			sessionId: session.id,
			status: 'running',
		})
	}
	if (launchableAgent.data === 'fold') {
		const typedSession = parseSessionForExecution(session)
		if (!typedSession) {
			logger.error({ sessionId: session.id }, 'Received an invalid session from the sync collection')
			await services.orpc.sessions.update({
				sessionId: session.id,
				status: 'failed',
				errorMessage: 'Session data could not be validated before continuation.',
			})
			return
		}
		const continuationKind = continuationKindFor(change)
		// Correlates with the sweeper's `lost_session_batch_completed.transitions[].id` and the
		// runner's `fold_prompt_admission` / `fold_prompt_lifecycle` records by session ID.
		logger.info(
			{
				session_id: session.id,
				change_type: change.type,
				previous_status: change.previousValue?.status ?? null,
				recovery_policy: foldAdmissionPolicyFor(continuationKind),
			},
			'fold_continuation_received',
		)
		// No early `running` report: the Fold runner reports it once this prompt owns the session.
		await runSession({
			session: typedSession,
			resumeSessionId: session.id,
			services,
			continuationKind,
			execute: services.executors.fold,
		})
		return
	}

	if (launchableAgent.data !== 'codelayer') {
		const outcome = await services.daemonRuntime.runPromise(
			Effect.gen(function* () {
				const claudeSessions = yield* ClaudeSessions
				return yield* claudeSessions.deliverFollowUpMessage({
					sessionId: session.id,
					prompt: session.prompt ?? '',
				})
			}),
		)
		if (outcome === 'accepted') {
			logger.info(`Sent follow-up message to live Claude session ${session.id}`)
			return
		}
		logger.info({ sessionId: session.id, outcome }, 'Live Claude send unavailable; falling back to resume')
	}

	// Update status to running before continuing through a persisted resume.
	await markSessionRunningBeforeDelivery()
	logger.info(`Marked session ${session.id} as running and continuing`)

	// Dispatch based on coding_agent
	const typedSession = parseSessionForExecution(session)
	if (!typedSession) {
		logger.error({ sessionId: session.id }, 'Received an invalid session from the sync collection')
		await services.orpc.sessions.update({
			sessionId: session.id,
			status: 'failed',
			errorMessage: 'Session data could not be validated before continuation.',
		})
		return
	}
	if (launchableAgent.data === 'codelayer') {
		await runSession({
			session: typedSession,
			resumeSessionId: session.id,
			services,
			execute: services.executors.codelayer,
		})
	} else {
		await runSession({
			session: typedSession,
			resumeSessionId: session.coding_agent_session_id ?? undefined,
			services,
			execute: services.executors.claude,
		})
	}
}
