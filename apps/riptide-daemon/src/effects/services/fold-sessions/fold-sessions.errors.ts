import { Data } from 'effect'

export class FoldSessionOpenError extends Data.TaggedError('FoldSessionOpenError')<{
	readonly sessionId: string
	readonly cause: unknown
	readonly message: string
}> {}

export class FoldEventProcessingError extends Data.TaggedError('FoldEventProcessingError')<{
	readonly sessionId: string
	readonly cause: unknown
	readonly message: string
}> {}

export class FoldPromptRunError extends Data.TaggedError('FoldPromptRunError')<{
	readonly sessionId: string
	readonly cause: unknown
	readonly message: string
}> {}

export class FoldSessionsShuttingDownError extends Data.TaggedError('FoldSessionsShuttingDownError')<{
	readonly sessionId: string
	readonly message: string
}> {}

/**
 * A lost-session resume could not stop the stale Fold prompt that still owned the session within
 * the takeover deadline, so the resumed prompt never ran.
 */
export class FoldPromptTakeoverError extends Data.TaggedError('FoldPromptTakeoverError')<{
	readonly sessionId: string
	readonly staleClaimId: string
	readonly message: string
}> {}

export class FoldSessionIdentityUnavailableError extends Data.TaggedError('FoldSessionIdentityUnavailableError')<{
	readonly sessionId: string
}> {}

export class FoldEventParentMissingError extends Data.TaggedError('FoldEventParentMissingError')<{
	readonly sessionId: string
	readonly agentId: string
}> {}

export class FoldEventModelMissingError extends Data.TaggedError('FoldEventModelMissingError')<{
	readonly sessionId: string
	readonly agentId: string
	readonly eventId: string
	readonly seq: number
}> {}
