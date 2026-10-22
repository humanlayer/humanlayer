import { Data } from 'effect'

export class WorkosAlreadyInvitedError extends Data.TaggedError('WorkosAlreadyInvitedError')<{
	email: string
}> {}

export class WorkosRateLimitError extends Data.TaggedError('WorkosRateLimitError')<{
	retryAfterMs?: number
	cause: unknown
}> {}

export class WorkosServerError extends Data.TaggedError('WorkosServerError')<{
	cause: unknown
}> {}

export class WorkosNetworkError extends Data.TaggedError('WorkosNetworkError')<{
	cause: unknown
}> {}

export class WorkosClientError extends Data.TaggedError('WorkosClientError')<{
	cause: unknown
}> {}

export type WorkosError =
	| WorkosAlreadyInvitedError
	| WorkosRateLimitError
	| WorkosServerError
	| WorkosNetworkError
	| WorkosClientError
