import { Data } from 'effect'

export class ClaudeExecutionError extends Data.TaggedError('ClaudeExecutionError')<{
	readonly sessionId: string
	readonly cause: unknown
	readonly message: string
}> {}

export class ClaudeSessionsShuttingDownError extends Data.TaggedError('ClaudeSessionsShuttingDownError')<{
	readonly sessionId: string
	readonly message: string
}> {}

export class ClaudeFollowUpDeliveryError extends Data.TaggedError('ClaudeFollowUpDeliveryError')<{
	readonly sessionId: string
	readonly cause: unknown
	readonly message: string
}> {}
