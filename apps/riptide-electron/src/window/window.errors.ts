import * as Data from 'effect/Data'

export class WindowCreationError extends Data.TaggedError('WindowCreationError')<{
	readonly cause: unknown
}> {}

export class WindowThemeError extends Data.TaggedError('WindowThemeError')<{
	readonly cause: unknown
}> {}

export class WindowZoomError extends Data.TaggedError('WindowZoomError')<{
	readonly cause: unknown
}> {}
