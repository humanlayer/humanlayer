import { releaseLockSync, type OwnedLock } from '@humanlayer/effect-proper-lockfile'
import * as Effect from 'effect/Effect'
import type * as Scope from 'effect/Scope'

const registerExitRelease = () => {
	let ownedLock: OwnedLock | undefined
	const listener = () => {
		if (ownedLock !== undefined) releaseLockSync(ownedLock)
	}
	process.on('exit', listener)
	return {
		arm: (lock: OwnedLock) => {
			ownedLock = lock
		},
		unregister: () => {
			process.off('exit', listener)
		},
	}
}

/**
 * Acquires a lease that is also released by `process.exit`, which skips Effect finalizers. The
 * exit listener is registered first so that it is unregistered only after the lease finalizer ran.
 */
export const acquireReleasedOnProcessExit = <Lease extends OwnedLock, E, R>(
	acquireLease: Effect.Effect<Lease, E, R>,
): Effect.Effect<Lease, E, R | Scope.Scope> =>
	Effect.gen(function* () {
		const exitRelease = yield* Effect.acquireRelease(Effect.sync(registerExitRelease), (registration) =>
			Effect.sync(registration.unregister),
		)
		const lease = yield* acquireLease.pipe(Effect.onError(() => Effect.sync(exitRelease.unregister)))
		exitRelease.arm({ lockPath: lease.lockPath, ownerId: lease.ownerId })
		return lease
	})
