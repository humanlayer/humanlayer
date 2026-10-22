import * as Sentry from '@sentry/bun'
import { Cause } from 'effect'

import type { ExecuteClaudeSessionInput } from './services/claude-sessions/claude-sessions.service'

/** Capture an unhandled session Cause at the sole Promise compatibility boundary. */
export function captureClaudeTerminalCause(cause: Cause.Cause<unknown>, input: ExecuteClaudeSessionInput): void {
	Sentry.captureException(Cause.squash(cause), {
		tags: {
			'claude.executor': 'effect',
			error_type: 'claude_execution',
		},
		extra: {
			cause: Cause.pretty(cause),
			sessionId: input.context.session.id,
		},
	})
}
