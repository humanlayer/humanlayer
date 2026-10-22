import type { LockCompromisedError } from '@humanlayer/effect-proper-lockfile'
import type { DaemonLeaseIdentity } from '@humanlayer/schemas/effect/daemon/identity'
import * as Context from 'effect/Context'
import type * as Effect from 'effect/Effect'
import type * as FileSystem from 'effect/FileSystem'
import type * as Path from 'effect/Path'
import type * as Scope from 'effect/Scope'

import type { DaemonInstanceAlreadyRunning, DaemonInstanceLockError } from './errors'

export interface AcquireDaemonInstanceLockInput extends DaemonLeaseIdentity {
	readonly generationId: string | null
}

export interface DaemonInstanceLease {
	readonly lockPath: string
	readonly monitorCompromise: Effect.Effect<never, LockCompromisedError>
}

export interface DaemonInstanceLockShape {
	readonly acquire: (
		input: AcquireDaemonInstanceLockInput,
	) => Effect.Effect<
		DaemonInstanceLease,
		DaemonInstanceAlreadyRunning | DaemonInstanceLockError,
		Scope.Scope | FileSystem.FileSystem | Path.Path
	>
}

export class DaemonInstanceLock extends Context.Service<DaemonInstanceLock, DaemonInstanceLockShape>()(
	'DaemonInstanceLock',
) {}

export type DaemonInstanceLeaseStateShape =
	| { readonly mode: 'locking-disabled' }
	| { readonly mode: 'active'; readonly lease: DaemonInstanceLease }

export class DaemonInstanceLeaseState extends Context.Service<
	DaemonInstanceLeaseState,
	DaemonInstanceLeaseStateShape
>()('DaemonInstanceLeaseState') {}
