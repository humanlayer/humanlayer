import * as Deferred from 'effect/Deferred'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Ref from 'effect/Ref'

import {
	LockAlreadyHeldError,
	LockAlreadyReleasedError,
	LockCompromisedError,
	ProperLockfile,
	type LockLease,
	type LockOptions,
} from './index'

export interface ProperLockfileTestOptions {
	readonly initiallyHeldPaths?: ReadonlyArray<string>
}

export const makeProperLockfileTestLayer = (options: ProperLockfileTestOptions = {}) =>
	Layer.effect(
		ProperLockfile,
		Effect.gen(function* () {
			const heldPaths = yield* Ref.make(new Set(options.initiallyHeldPaths ?? []))

			const acquire = Effect.fn('proper_lockfile_test.acquire')(function* (input: LockOptions) {
				const lockPath = input.lockPath ?? `${input.path}.lock`
				const acquired = yield* Ref.modify(heldPaths, (paths) => {
					if (paths.has(lockPath)) return [false, paths] as const
					const next = new Set(paths)
					next.add(lockPath)
					return [true, next] as const
				})
				if (!acquired) {
					return yield* Effect.fail(new LockAlreadyHeldError({ path: input.path, lockPath }))
				}
				const compromised = yield* Deferred.make<never, LockCompromisedError>()
				const released = yield* Ref.make(false)
				const release = Ref.modify(released, (wasReleased) => [wasReleased, true] as const).pipe(
					Effect.flatMap((wasReleased) =>
						wasReleased
							? Effect.fail(new LockAlreadyReleasedError({ path: input.path, lockPath }))
							: Ref.update(heldPaths, (paths) => {
									const next = new Set(paths)
									next.delete(lockPath)
									return next
								}),
					),
				)
				const lease: LockLease = {
					path: input.path,
					lockPath,
					ownerId: `test-owner:${lockPath}`,
					acquiredAt: 0,
					failWhenLockOwnershipIsCompromised: Deferred.await(compromised),
					release,
				}
				yield* Effect.addFinalizer(() =>
					release.pipe(Effect.catchTag('LockAlreadyReleasedError', () => Effect.void)),
				)
				return lease
			})

			const check = Effect.fn('proper_lockfile_test.check')((input: LockOptions) =>
				Ref.get(heldPaths).pipe(Effect.map((paths) => paths.has(input.lockPath ?? `${input.path}.lock`))),
			)

			const withLock: (typeof ProperLockfile.Service)['withLock'] = (input, effect) =>
				Effect.scoped(
					Effect.gen(function* () {
						yield* acquire(input)
						return yield* effect
					}),
				)

			return ProperLockfile.of({ acquire, check, withLock })
		}),
	)
