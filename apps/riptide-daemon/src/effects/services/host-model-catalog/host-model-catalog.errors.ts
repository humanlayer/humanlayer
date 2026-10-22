import { Data } from 'effect'

export type ClaudeModelProbeOperation = 'spawn' | 'supported_models' | 'timeout'

/** The installed Claude Code binary could not report its models. */
export class ClaudeModelProbeError extends Data.TaggedError('ClaudeModelProbeError')<{
	readonly operation: ClaudeModelProbeOperation
	readonly cause?: unknown
}> {
	/** A missing or failing binary is a host condition, not a defect worth an alert. */
	get unexpected(): boolean {
		return this.operation === 'supported_models'
	}
}

export type CodexModelProbeReason =
	| 'custom_backend'
	| 'not_logged_in'
	| 'transport'
	| 'unauthorized'
	| 'status'
	| 'malformed_response'
	| 'timeout'

/** The Codex backend could not be asked for its models. */
export class CodexModelProbeError extends Data.TaggedError('CodexModelProbeError')<{
	readonly reason: CodexModelProbeReason
	readonly status?: number
	readonly cause?: unknown
}> {
	/** Not being logged in or pointing at a custom backend is configuration, not a failure to alert on. */
	get unexpected(): boolean {
		return this.reason !== 'custom_backend' && this.reason !== 'not_logged_in' && this.reason !== 'unauthorized'
	}
}
