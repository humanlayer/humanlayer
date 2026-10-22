import * as Data from 'effect/Data'

export class LockAlreadyHeldError extends Data.TaggedError('LockAlreadyHeldError')<{
	readonly path: string
	readonly lockPath: string
}> {}

export class LockAcquireError extends Data.TaggedError('LockAcquireError')<{
	readonly path: string
	readonly lockPath: string
	readonly cause: unknown
	readonly message: string
}> {}

export class LockCheckError extends Data.TaggedError('LockCheckError')<{
	readonly path: string
	readonly lockPath: string
	readonly cause: unknown
	readonly message: string
}> {}

export class LockCompromisedError extends Data.TaggedError('LockCompromisedError')<{
	readonly path: string
	readonly lockPath: string
	readonly reason: 'lock-missing' | 'owner-changed' | 'refresh-overdue'
	readonly cause?: unknown
}> {}

export class LockReleaseError extends Data.TaggedError('LockReleaseError')<{
	readonly path: string
	readonly lockPath: string
	readonly cause: unknown
	readonly message: string
}> {}

export class LockAlreadyReleasedError extends Data.TaggedError('LockAlreadyReleasedError')<{
	readonly path: string
	readonly lockPath: string
}> {}

export type LockAcquisitionError = LockAlreadyHeldError | LockAcquireError
export type LockReleaseFailure = LockAlreadyReleasedError | LockReleaseError
