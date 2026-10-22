import * as Sentry from '@sentry/bun'
import { Effect } from 'effect'

import { runSession } from '@/agents/shared/run-session'

import { DaemonApi } from '../daemon-api/daemon-api.service'
import { ClaudeExecutionError } from './claude-session-errors'
import type { ExecuteClaudeSessionInput } from './claude-sessions.service'

export function finalizeInterruptedRun(input: ExecuteClaudeSessionInput) {
	return Effect.gen(function* () {
		const api = yield* DaemonApi
		const { interruptState, services, session } = input.context
		const snapshot = yield* interruptState.get
		if (!snapshot.wasInterrupted || services.shutdown.isDaemonShuttingDown()) return

		const sessionId = session.id
		if (!snapshot.resumeWithPrompt) {
			yield* Effect.logInfo('Session interrupted, setting status to interrupted').pipe(
				Effect.annotateLogs({ sessionId }),
			)
			yield* api.updateSession({ sessionId, status: 'interrupted' })
			return
		}

		const prompt = snapshot.resumeWithPrompt
		const codingAgentSessionId = services.collections.sessions.get(sessionId)?.coding_agent_session_id
		if (!codingAgentSessionId) {
			yield* Effect.sync(() =>
				Sentry.captureException(
					new Error('Invariant: Session without a coding_agent_session_id was interrupted'),
					{
						extra: {
							sessionId,
							userId: session.created_by,
							organizationId: session.organization_id,
						},
					},
				),
			)
		}

		yield* Effect.logInfo('Resuming interrupted session with replacement prompt').pipe(
			Effect.annotateLogs({ sessionId }),
		)
		yield* api.createConversationEvent({
			sessionId,
			eventType: 'message',
			role: 'user',
			codingAgentSessionId: codingAgentSessionId ?? '',
			content: prompt,
		})
		yield* Effect.tryPromise({
			try: () =>
				runSession({
					session: { ...session, prompt },
					resumeSessionId: codingAgentSessionId ?? undefined,
					services,
					execute: services.executors.claude,
				}),
			catch: (cause) =>
				new ClaudeExecutionError({
					sessionId,
					cause,
					message: 'Replacement-prompt continuation failed',
				}),
		})
	}).pipe(
		Effect.mapError(
			(cause) =>
				new ClaudeExecutionError({
					sessionId: input.context.session.id,
					cause,
					message: 'Failed to finalize interrupted Claude session',
				}),
		),
	)
}
