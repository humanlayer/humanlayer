import type { SessionErrorReason } from '@humanlayer/schemas/effect/session/session-error-reason'
import { Data } from 'effect'

import { describeUnknownError } from '@/lib/safe-error-display'

/**
 * Renders an unknown throwable as readable text, following `Error.cause` chains so the
 * detail the Claude Agent SDK puts in nested causes (exit code, stderr tail, auth failure)
 * reaches the session's error message instead of being collapsed to the error's tag.
 */
export const describeClaudeSdkCause = describeUnknownError

// The Agent SDK has no typed auth signal, so match its rendered failure text here — once, at the
// source — and hand the UI a typed reason instead of every client re-parsing the message.
const CLAUDE_AUTH_ERROR_FRAGMENTS = ['not logged in', 'run /login', 'invalid api key', 'oauth token']

export const classifyClaudeSessionErrorReason = (errorMessage: string): SessionErrorReason | null => {
	const normalized = errorMessage.toLowerCase()
	return CLAUDE_AUTH_ERROR_FRAGMENTS.some((fragment) => normalized.includes(fragment)) ? 'auth_required' : null
}

export class ClaudeSdkError extends Data.TaggedError('ClaudeSdkError')<{
	readonly operation:
		| 'open'
		| 'output'
		| 'close'
		| 'sendMessage'
		| 'interrupt'
		| 'setModel'
		| 'setPermissionMode'
		| 'supportedCommands'
		| 'readUsage'
	readonly cause: unknown
}> {
	override get message(): string {
		return `Claude SDK ${this.operation} failed: ${describeClaudeSdkCause(this.cause)}`
	}
}
