import * as Sentry from '@sentry/bun'
import { Cause, Duration, Effect } from 'effect'

import type { DaemonServices } from '@/agents/claudecode/types'
import type { SessionChangeMessage } from '@/collections/types'
import { ClaudeSessions } from '@/effects/services/claude-sessions/claude-sessions.service'

const stopArchivedClaudeSession = (change: SessionChangeMessage, services: DaemonServices) =>
	Effect.gen(function* () {
		const session = change.value
		const latest = services.collections.sessions.get(session.id)
		if (latest !== undefined && !latest.archived) {
			yield* Effect.logInfo('Skipping stale Claude session cleanup').pipe(
				Effect.annotateLogs({ session_id: session.id, change_type: change.type }),
			)
			return
		}

		const claudeSessions = yield* ClaudeSessions
		yield* Effect.logInfo('Starting archived Claude session cleanup').pipe(
			Effect.annotateLogs({ session_id: session.id, change_type: change.type }),
		)
		const [cleanupDuration, outcome] = yield* claudeSessions
			.stopClaudeSession({
				sessionId: session.id,
				reason: change.type === 'delete' ? 'delete' : 'archive',
			})
			.pipe(Effect.timed)
		yield* Effect.logInfo('Archived Claude session cleanup completed').pipe(
			Effect.annotateLogs({
				session_id: session.id,
				change_type: change.type,
				outcome,
				cleanup_duration_ms: Duration.toMillis(cleanupDuration),
			}),
		)
	}).pipe(
		Effect.catchCause((cause) =>
			Effect.logError('Archived Claude session cleanup failed').pipe(
				Effect.annotateLogs({ session_id: change.value.id, change_type: change.type, cause }),
				Effect.andThen(
					Effect.sync(() =>
						Sentry.captureException(Cause.squash(cause), {
							tags: {
								error_type: 'claude_session_cleanup_failed',
								session_id: change.value.id,
							},
							extra: { cause: Cause.pretty(cause), changeType: change.type },
						}),
					),
				),
			),
		),
		Effect.withSpan('daemon_subscriptions.cleanup_archived_claude_session', {
			attributes: { session_id: change.value.id, change_type: change.type },
		}),
	)

export const handleArchivedSessionChange = (change: SessionChangeMessage, services: DaemonServices): void => {
	switch (change.value.coding_agent) {
		case 'claude':
			services.daemonRuntime.runFork(stopArchivedClaudeSession(change, services))
			return
		case 'codelayer':
		case 'fold':
		case 'opencode':
		case 'pi':
			return
	}
}
