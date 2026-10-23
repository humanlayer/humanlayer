import * as Data from 'effect/Data'

export class DeepLinkPlatformError extends Data.TaggedError('DeepLinkPlatformError')<{
	readonly operation: string
	readonly cause: unknown
}> {}
