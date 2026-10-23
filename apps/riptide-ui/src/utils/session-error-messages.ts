import type { SessionErrorReason } from '@humanlayer/schemas/effect/session/session-error-reason'

export const CLAUDE_CODE_START_FAILED_MESSAGE =
	'Claude Code failed to start. Try updating Claude Code and create a new session'

// Sessions that failed before `sessions.error_reason` existed carry only this message.
const LEGACY_START_FAILED_MESSAGE = 'Unable to locate coding agent session ID'

export function resolveSessionErrorReason(
	errorReason: SessionErrorReason | null | undefined,
	errorMessage: string | null | undefined,
): SessionErrorReason | null {
	if (errorReason) return errorReason
	return errorMessage?.includes(LEGACY_START_FAILED_MESSAGE) ? 'start_failed' : null
}

export function getSessionErrorDisplayMessage(
	errorReason: SessionErrorReason | null | undefined,
	errorMessage: string | null | undefined,
): string | null | undefined {
	if (resolveSessionErrorReason(errorReason, errorMessage) === 'start_failed') return CLAUDE_CODE_START_FAILED_MESSAGE
	return errorMessage
}
