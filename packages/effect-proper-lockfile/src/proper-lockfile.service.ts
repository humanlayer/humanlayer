import * as Context from 'effect/Context'
import type * as Duration from 'effect/Duration'
import type * as Effect from 'effect/Effect'
import type * as FileSystem from 'effect/FileSystem'
import type * as Path from 'effect/Path'
import type * as Scope from 'effect/Scope'

import type { LockAcquisitionError, LockCheckError, LockCompromisedError, LockReleaseFailure } from './errors'

export interface LockOptions {
	readonly path: string
	readonly lockPath?: string
	readonly realPath?: boolean
	readonly stale?: Duration.Input
	readonly updateInterval?: Duration.Input
	readonly retries?: number | LockRetryOptions
	readonly retryDelay?: Duration.Input
	readonly ownerMetadata?: Readonly<Record<string, string | number | boolean | null>>
}

export interface LockRetryOptions {
	readonly retries: number
	readonly factor?: number
	readonly minTimeout?: Duration.Input
	readonly maxTimeout?: Duration.Input
	readonly randomize?: boolean
}

export interface LockLease {
	readonly path: string
	readonly lockPath: string
	readonly ownerId: string
	readonly acquiredAt: number
	readonly failWhenLockOwnershipIsCompromised: Effect.Effect<never, LockCompromisedError>
	readonly release: Effect.Effect<void, LockReleaseFailure>
}

export type ProperLockfileRequirements = FileSystem.FileSystem | Path.Path

export interface ProperLockfileShape {
	readonly acquire: (
		input: LockOptions,
	) => Effect.Effect<LockLease, LockAcquisitionError, Scope.Scope | ProperLockfileRequirements>
	readonly check: (input: LockOptions) => Effect.Effect<boolean, LockCheckError, ProperLockfileRequirements>
	readonly withLock: <A, E, R>(
		input: LockOptions,
		effect: Effect.Effect<A, E, R>,
	) => Effect.Effect<A, E | LockAcquisitionError | LockCompromisedError, R | ProperLockfileRequirements>
}

export class ProperLockfile extends Context.Service<ProperLockfile, ProperLockfileShape>()('ProperLockfile') {}
