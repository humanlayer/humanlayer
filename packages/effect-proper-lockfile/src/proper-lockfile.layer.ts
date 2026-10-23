import * as Clock from 'effect/Clock'
import * as Data from 'effect/Data'
import * as DateTime from 'effect/DateTime'
import * as Deferred from 'effect/Deferred'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as PlatformError from 'effect/PlatformError'
import * as Random from 'effect/Random'
import * as Ref from 'effect/Ref'

import {
	LockAcquireError,
	LockAlreadyReleasedError,
	LockAlreadyHeldError,
	LockCheckError,
	LockCompromisedError,
	LockReleaseError,
	type LockReleaseFailure,
} from './errors'
import { ProperLockfile, type LockLease, type LockOptions, type ProperLockfileShape } from './proper-lockfile.service'

const MINIMUM_STALE_MILLIS = 2_000
const MINIMUM_UPDATE_MILLIS = 1_000
const DEFAULT_STALE_MILLIS = 10_000
const DEFAULT_RETRY_DELAY_MILLIS = 1_000
export const OWNER_FILE_NAME = 'owner.json'

interface LockOwner extends Readonly<Record<string, unknown>> {
	readonly ownerId: string
	readonly acquiredAt: number
}

interface LockSnapshot {
	readonly rawOwner: string | undefined
	readonly owner: LockOwner | undefined
	readonly ownerState: 'missing' | 'malformed' | 'valid'
	readonly mtime: Date
}

const decodeLockOwner = (contents: string) =>
	Effect.try({
		try: () => {
			const value: unknown = JSON.parse(contents)
			if (
				typeof value !== 'object' ||
				value === null ||
				typeof (value as LockOwner).ownerId !== 'string' ||
				typeof (value as LockOwner).acquiredAt !== 'number' ||
				!Number.isFinite((value as LockOwner).acquiredAt)
			) {
				throw new TypeError('Invalid lock owner file')
			}
			return value as LockOwner
		},
		catch: (cause) => new LockOperationError({ cause }),
	})

interface ResolvedLockOptions {
	readonly path: string
	readonly lockPath: string
	readonly staleMillis: number
	readonly updateMillis: number
	readonly retries: number
	readonly retryFactor: number
	readonly retryMinDelayMillis: number
	readonly retryMaxDelayMillis: number
	readonly randomizeRetries: boolean
	readonly ownerMetadata: Readonly<Record<string, string | number | boolean | null>>
}

type MtimePrecision = 'milliseconds' | 'seconds'

class LockOperationError extends Data.TaggedError('LockOperationError')<{
	readonly cause: unknown
}> {}

class LockMissingError extends Data.TaggedError('LockMissingError')<{}> {}

const isPlatformReason = (error: PlatformError.PlatformError, tag: PlatformError.SystemErrorTag): boolean =>
	Match.value(error.reason).pipe(
		Match.tag(tag, () => true),
		Match.orElse(() => false),
	)

const invalidOption = (name: string, value: unknown) =>
	new LockOperationError({
		cause: new TypeError(`Lock option ${name} must be finite and valid; received ${String(value)}`),
	})

const durationMillis = (name: string, input: Duration.Input | undefined, fallback: number) =>
	(typeof input === 'number' && !Number.isFinite(input)
		? Effect.fail(invalidOption(name, input))
		: Effect.try({
				try: () => (input === undefined ? fallback : Duration.toMillis(Duration.fromInputUnsafe(input))),
				catch: () => invalidOption(name, input),
			})
	).pipe(
		Effect.flatMap((value) =>
			Number.isFinite(value) && value >= 0 ? Effect.succeed(value) : Effect.fail(invalidOption(name, input)),
		),
	)

const randomId = Effect.fn('proper_lockfile.random_id')(function* () {
	const parts = yield* Effect.all(
		Array.from({ length: 4 }, () => Random.nextIntBetween(0, 0x1_0000_0000, { halfOpen: true })),
	)
	return parts.map((part) => part.toString(16).padStart(8, '0')).join('')
})

const normalizeRetries = Effect.fn('proper_lockfile.normalize_retries')(function* (input: LockOptions) {
	const options = typeof input.retries === 'number' ? { retries: input.retries } : (input.retries ?? { retries: 0 })
	if (!Number.isSafeInteger(options.retries) || options.retries < 0)
		return yield* Effect.fail(invalidOption('retries', options.retries))
	const factor = options.factor ?? 2
	if (!Number.isFinite(factor) || factor < 1) return yield* Effect.fail(invalidOption('retries.factor', factor))
	const fixedDelay =
		input.retryDelay === undefined
			? undefined
			: yield* durationMillis('retryDelay', input.retryDelay, DEFAULT_RETRY_DELAY_MILLIS)
	const minTimeout =
		fixedDelay ?? (yield* durationMillis('retries.minTimeout', options.minTimeout, DEFAULT_RETRY_DELAY_MILLIS))
	const maxTimeout =
		fixedDelay ?? (yield* durationMillis('retries.maxTimeout', options.maxTimeout, Number.MAX_SAFE_INTEGER))
	if (maxTimeout < minTimeout) return yield* Effect.fail(invalidOption('retries.maxTimeout', maxTimeout))
	return {
		retries: options.retries,
		factor: fixedDelay === undefined ? factor : 1,
		minTimeout,
		maxTimeout,
		randomize: options.randomize ?? false,
	}
})

const normalizeOptions = Effect.fn('proper_lockfile.normalize_options')(function* (input: LockOptions) {
	const fileSystem = yield* FileSystem.FileSystem
	const pathService = yield* Path.Path
	if (input.realPath !== undefined && typeof input.realPath !== 'boolean')
		return yield* Effect.fail(invalidOption('realPath', input.realPath))
	const retryInput = typeof input.retries === 'object' && input.retries !== null ? input.retries : undefined
	if (retryInput?.randomize !== undefined && typeof retryInput.randomize !== 'boolean')
		return yield* Effect.fail(invalidOption('retries.randomize', retryInput.randomize))
	const canonicalPath =
		input.realPath === false ? pathService.resolve(input.path) : yield* fileSystem.realPath(input.path)
	const lockPath = input.lockPath === undefined ? `${canonicalPath}.lock` : pathService.resolve(input.lockPath)
	const staleMillis = Math.max(
		yield* durationMillis('stale', input.stale, DEFAULT_STALE_MILLIS),
		MINIMUM_STALE_MILLIS,
	)
	const requestedUpdateMillis = yield* durationMillis('updateInterval', input.updateInterval, staleMillis / 2)
	const updateMillis = Math.max(Math.min(requestedUpdateMillis, staleMillis / 2), MINIMUM_UPDATE_MILLIS)
	const retry = yield* normalizeRetries(input)
	const inputOwnerMetadata = input.ownerMetadata ?? {}
	const ownerMetadata = { ...inputOwnerMetadata }
	delete ownerMetadata.ownerId
	delete ownerMetadata.acquiredAt
	for (const [key, value] of Object.entries(ownerMetadata)) {
		if (
			value !== null &&
			typeof value !== 'string' &&
			typeof value !== 'boolean' &&
			(typeof value !== 'number' || !Number.isFinite(value))
		)
			return yield* Effect.fail(invalidOption(`ownerMetadata.${key}`, value))
	}
	return {
		path: canonicalPath,
		lockPath,
		staleMillis,
		updateMillis,
		retries: retry.retries,
		retryFactor: retry.factor,
		retryMinDelayMillis: Math.max(0, Number(retry.minTimeout)),
		retryMaxDelayMillis: Math.max(0, Number(retry.maxTimeout)),
		randomizeRetries: retry.randomize,
		ownerMetadata,
	} satisfies ResolvedLockOptions
})

const readOwner = Effect.fn('proper_lockfile.read_owner')(function* (input: {
	readonly lockPath: string
	readonly ownerPath: string
}) {
	const fileSystem = yield* FileSystem.FileSystem
	const contents = yield* fileSystem
		.readFileString(input.ownerPath)
		.pipe(
			Effect.mapError((error) =>
				isPlatformReason(error, 'NotFound') ? new LockMissingError() : new LockOperationError({ cause: error }),
			),
		)
	return yield* decodeLockOwner(contents)
})

const lockIsStale = Effect.fn('proper_lockfile.is_stale')(function* (input: ResolvedLockOptions) {
	const fileSystem = yield* FileSystem.FileSystem
	const stat = yield* fileSystem
		.stat(input.lockPath)
		.pipe(
			Effect.mapError((error) =>
				isPlatformReason(error, 'NotFound') ? new LockMissingError() : new LockOperationError({ cause: error }),
			),
		)
	const modifiedAt = Option.getOrElse(stat.mtime, () => new Date(0)).getTime()
	const now = yield* Clock.currentTimeMillis
	return modifiedAt < now - input.staleMillis
})

const mtimeForPrecision = (now: number, precision: MtimePrecision): Date =>
	new Date(precision === 'seconds' ? Math.ceil(now / 1_000) * 1_000 : now)

const probeMtimePrecision = Effect.fn('proper_lockfile.probe_mtime_precision')(function* (input: {
	readonly lockPath: string
	readonly now: number
}) {
	const fileSystem = yield* FileSystem.FileSystem
	const probeTime = DateTime.toDateUtc(DateTime.makeUnsafe(Math.ceil(input.now / 1_000) * 1_000 + 5))
	yield* fileSystem
		.utimes(input.lockPath, probeTime, probeTime)
		.pipe(Effect.mapError((cause) => new LockOperationError({ cause })))
	const stat = yield* fileSystem
		.stat(input.lockPath)
		.pipe(Effect.mapError((cause) => new LockOperationError({ cause })))
	const actualMtime = Option.getOrElse(stat.mtime, () => new Date(0))
	return actualMtime.getTime() % 1_000 === 0 ? ('seconds' as const) : ('milliseconds' as const)
})

const readLockSnapshot = Effect.fn('proper_lockfile.read_lock_snapshot')(function* (input: {
	readonly lockPath: string
	readonly ownerPath: string
}) {
	const fileSystem = yield* FileSystem.FileSystem
	const stat = yield* fileSystem
		.stat(input.lockPath)
		.pipe(Effect.mapError((cause) => new LockOperationError({ cause })))
	const mtime = Option.getOrElse(stat.mtime, () => new Date(0))
	const rawOwner = yield* fileSystem.readFileString(input.ownerPath).pipe(
		Effect.map((raw) => raw as string | undefined),
		Effect.catchIf(
			(error) => isPlatformReason(error, 'NotFound'),
			() => Effect.succeed(undefined),
		),
		Effect.mapError((cause) => new LockOperationError({ cause })),
	)
	if (rawOwner === undefined)
		return { rawOwner, owner: undefined, ownerState: 'missing', mtime } satisfies LockSnapshot
	const decoded = yield* decodeLockOwner(rawOwner).pipe(Effect.option)
	return Option.match(decoded, {
		onNone: () => ({ rawOwner, owner: undefined, ownerState: 'malformed', mtime }) satisfies LockSnapshot,
		onSome: (owner) => ({ rawOwner, owner, ownerState: 'valid', mtime }) satisfies LockSnapshot,
	})
})

const snapshotsMatch = (left: LockSnapshot, right: LockSnapshot): boolean =>
	left.rawOwner === right.rawOwner &&
	left.ownerState === right.ownerState &&
	left.mtime.getTime() === right.mtime.getTime()

const restoreQuarantinedLock = Effect.fn('proper_lockfile.restore_quarantined_lock')(function* (input: {
	readonly lockPath: string
	readonly quarantinePath: string
	readonly snapshot: LockSnapshot
}) {
	const fileSystem = yield* FileSystem.FileSystem
	const created = yield* fileSystem.makeDirectory(input.lockPath, { mode: 0o700 }).pipe(
		Effect.as(true),
		Effect.catchIf(
			(error) => isPlatformReason(error, 'AlreadyExists'),
			() => Effect.succeed(false),
		),
		Effect.mapError((cause) => new LockOperationError({ cause })),
	)
	if (!created) return
	const ownerPath = `${input.lockPath}/${OWNER_FILE_NAME}`
	yield* Effect.gen(function* () {
		if (input.snapshot.rawOwner !== undefined)
			yield* fileSystem.writeFileString(ownerPath, input.snapshot.rawOwner, { mode: 0o600 })
		yield* fileSystem.utimes(input.lockPath, input.snapshot.mtime, input.snapshot.mtime)
	}).pipe(
		Effect.tapError(() => fileSystem.remove(input.lockPath, { recursive: true, force: true }).pipe(Effect.ignore)),
		Effect.mapError((cause) => new LockOperationError({ cause })),
	)
	yield* fileSystem
		.remove(input.quarantinePath, { recursive: true, force: true })
		.pipe(Effect.mapError((cause) => new LockOperationError({ cause })))
})

const removeOwnedLock = Effect.fn('proper_lockfile.remove_owned_lock')(function* (input: {
	readonly path: string
	readonly lockPath: string
	readonly ownerPath: string
	readonly ownerId: string
}) {
	const fileSystem = yield* FileSystem.FileSystem
	const canonicalOwner = yield* readOwner({ lockPath: input.lockPath, ownerPath: input.ownerPath }).pipe(
		Effect.catchTag('LockMissingError', () => Effect.succeed(undefined)),
	)
	if (canonicalOwner === undefined || canonicalOwner.ownerId !== input.ownerId) return
	const quarantinePath = `${input.lockPath}.release.${yield* randomId()}`
	const moved = yield* fileSystem.rename(input.lockPath, quarantinePath).pipe(
		Effect.as(true),
		Effect.catchIf(
			(error) => isPlatformReason(error, 'NotFound'),
			() => Effect.succeed(false),
		),
		Effect.mapError((cause) => new LockOperationError({ cause })),
	)
	if (!moved) return
	const movedSnapshot = yield* readLockSnapshot({
		lockPath: quarantinePath,
		ownerPath: `${quarantinePath}/${OWNER_FILE_NAME}`,
	})
	const restore = restoreQuarantinedLock({ lockPath: input.lockPath, quarantinePath, snapshot: movedSnapshot })
	if (
		movedSnapshot.owner?.ownerId !== input.ownerId ||
		movedSnapshot.owner.acquiredAt !== canonicalOwner.acquiredAt
	) {
		yield* restore
		return
	}
	yield* fileSystem.remove(quarantinePath, { recursive: true, force: true }).pipe(
		Effect.tapError(() => restore),
		Effect.mapError(
			(cause) =>
				new LockReleaseError({
					path: input.path,
					lockPath: input.lockPath,
					cause,
					message: 'Failed to remove an owned lock directory',
				}),
		),
	)
})

const acquireDirectory = Effect.fn('proper_lockfile.acquire_directory')(function* (input: ResolvedLockOptions) {
	const fileSystem = yield* FileSystem.FileSystem
	const pathService = yield* Path.Path
	const ownerId = yield* randomId()
	const acquiredAt = yield* Clock.currentTimeMillis
	const ownerPath = pathService.join(input.lockPath, OWNER_FILE_NAME)
	const owner: LockOwner = { ...input.ownerMetadata, ownerId, acquiredAt }

	const create = fileSystem
		.makeDirectory(input.lockPath, { mode: 0o700 })
		.pipe(
			Effect.mapError((error) =>
				isPlatformReason(error, 'AlreadyExists')
					? new LockAlreadyHeldError({ path: input.path, lockPath: input.lockPath })
					: new LockOperationError({ cause: error }),
			),
		)

	const writeOwner = fileSystem
		.writeFileString(ownerPath, JSON.stringify(owner), { mode: 0o600 })
		.pipe(Effect.mapError((cause) => new LockOperationError({ cause })))

	yield* create
	yield* writeOwner.pipe(
		Effect.tapError(() => fileSystem.remove(input.lockPath, { recursive: true, force: true }).pipe(Effect.ignore)),
	)
	const mtimePrecision = yield* probeMtimePrecision({ lockPath: input.lockPath, now: acquiredAt }).pipe(
		Effect.tapError(() => fileSystem.remove(input.lockPath, { recursive: true, force: true }).pipe(Effect.ignore)),
	)
	return { ownerId, acquiredAt, ownerPath, mtimePrecision }
})

const takeOverStaleLock = Effect.fn('proper_lockfile.take_over_stale_lock')(function* (input: ResolvedLockOptions) {
	const fileSystem = yield* FileSystem.FileSystem
	const pathService = yield* Path.Path
	const beforeSnapshot = yield* readLockSnapshot({
		lockPath: input.lockPath,
		ownerPath: pathService.join(input.lockPath, OWNER_FILE_NAME),
	})
	const quarantinePath = `${input.lockPath}.stale.${yield* randomId()}`
	yield* fileSystem
		.rename(input.lockPath, quarantinePath)
		.pipe(
			Effect.mapError((error) =>
				isPlatformReason(error, 'NotFound')
					? new LockAlreadyHeldError({ path: input.path, lockPath: input.lockPath })
					: new LockOperationError({ cause: error }),
			),
		)
	const restoreBeforeSnapshot = restoreQuarantinedLock({
		lockPath: input.lockPath,
		quarantinePath,
		snapshot: beforeSnapshot,
	})
	const movedSnapshot = yield* readLockSnapshot({
		lockPath: quarantinePath,
		ownerPath: pathService.join(quarantinePath, OWNER_FILE_NAME),
	}).pipe(Effect.tapError(() => restoreBeforeSnapshot))
	const now = yield* Clock.currentTimeMillis
	if (!snapshotsMatch(movedSnapshot, beforeSnapshot) || movedSnapshot.mtime.getTime() >= now - input.staleMillis) {
		yield* restoreQuarantinedLock({ lockPath: input.lockPath, quarantinePath, snapshot: movedSnapshot })
		return yield* Effect.fail(new LockAlreadyHeldError({ path: input.path, lockPath: input.lockPath }))
	}
	return quarantinePath
})

const acquireOnce = Effect.fn('proper_lockfile.acquire_once')(function* (input: ResolvedLockOptions) {
	const fileSystem = yield* FileSystem.FileSystem

	return yield* acquireDirectory(input).pipe(
		Effect.catchTag('LockAlreadyHeldError', () =>
			lockIsStale(input).pipe(
				Effect.map((stale): boolean | 'missing' => stale),
				Effect.catchTag('LockMissingError', () => Effect.succeed('missing' as const)),
				Effect.flatMap((stale) => {
					if (stale === 'missing') return acquireDirectory(input)
					if (!stale)
						return Effect.fail(new LockAlreadyHeldError({ path: input.path, lockPath: input.lockPath }))
					return takeOverStaleLock(input).pipe(
						Effect.flatMap((quarantinePath) =>
							acquireDirectory(input).pipe(
								Effect.tap(() =>
									fileSystem
										.remove(quarantinePath, { recursive: true, force: true })
										.pipe(Effect.ignore),
								),
							),
						),
					)
				}),
			),
		),
	)
})

const acquireWithRetries = Effect.fn('proper_lockfile.acquire_with_retries')(function* (options: ResolvedLockOptions) {
	const attempt = (
		retryNumber: number,
	): Effect.Effect<
		{
			readonly ownerId: string
			readonly acquiredAt: number
			readonly ownerPath: string
			readonly mtimePrecision: MtimePrecision
		},
		LockAlreadyHeldError | LockOperationError | PlatformError.PlatformError,
		FileSystem.FileSystem | Path.Path
	> =>
		acquireOnce(options).pipe(
			Effect.catchTag('LockAlreadyHeldError', (error) => {
				if (retryNumber >= options.retries) return Effect.fail(error)
				const baseDelay = Math.min(
					options.retryMinDelayMillis * options.retryFactor ** retryNumber,
					options.retryMaxDelayMillis,
				)
				const delay = options.randomizeRetries
					? Random.nextBetween(baseDelay, baseDelay * 2)
					: Effect.succeed(baseDelay)
				return delay.pipe(
					Effect.flatMap((millis) => Effect.sleep(millis)),
					Effect.andThen(attempt(retryNumber + 1)),
				)
			}),
		)
	return yield* attempt(0)
})

const refreshOwnedLock = Effect.fn('proper_lockfile.refresh')(function* (input: {
	readonly options: ResolvedLockOptions
	readonly ownerPath: string
	readonly ownerId: string
	readonly mtimePrecision: MtimePrecision
	readonly lastUpdate: Ref.Ref<number>
}) {
	const fileSystem = yield* FileSystem.FileSystem
	const owner = yield* readOwner({ lockPath: input.options.lockPath, ownerPath: input.ownerPath }).pipe(
		Effect.catchTag('LockMissingError', () =>
			Effect.fail(
				new LockCompromisedError({
					path: input.options.path,
					lockPath: input.options.lockPath,
					reason: 'lock-missing',
				}),
			),
		),
	)
	if (owner.ownerId !== input.ownerId) {
		return yield* Effect.fail(
			new LockCompromisedError({
				path: input.options.path,
				lockPath: input.options.lockPath,
				reason: 'owner-changed',
			}),
		)
	}
	const now = yield* Clock.currentTimeMillis
	const modifiedAt = mtimeForPrecision(now, input.mtimePrecision)
	yield* fileSystem
		.utimes(input.options.lockPath, modifiedAt, modifiedAt)
		.pipe(Effect.mapError((cause) => new LockOperationError({ cause })))
	const ownerAfterUpdate = yield* readOwner({ lockPath: input.options.lockPath, ownerPath: input.ownerPath }).pipe(
		Effect.catchTag('LockMissingError', () =>
			Effect.fail(
				new LockCompromisedError({
					path: input.options.path,
					lockPath: input.options.lockPath,
					reason: 'lock-missing',
				}),
			),
		),
	)
	if (ownerAfterUpdate.ownerId !== input.ownerId)
		return yield* Effect.fail(
			new LockCompromisedError({
				path: input.options.path,
				lockPath: input.options.lockPath,
				reason: 'owner-changed',
			}),
		)
	yield* Ref.set(input.lastUpdate, now)
})

const monitorLock = Effect.fn('proper_lockfile.monitor')(function* (input: {
	readonly options: ResolvedLockOptions
	readonly ownerPath: string
	readonly ownerId: string
	readonly mtimePrecision: MtimePrecision
	readonly compromised: Deferred.Deferred<never, LockCompromisedError>
	readonly ready: Deferred.Deferred<void>
	readonly releaseState: Ref.Ref<'held' | 'releasing' | 'released'>
}) {
	const lastUpdate = yield* Ref.make(yield* Clock.currentTimeMillis)
	const refresh = refreshOwnedLock({ ...input, lastUpdate }).pipe(
		Effect.catchTag('LockOperationError', (error) =>
			Effect.gen(function* () {
				const now = yield* Clock.currentTimeMillis
				const lastSuccessfulUpdate = yield* Ref.get(lastUpdate)
				if (now >= lastSuccessfulUpdate + input.options.staleMillis) {
					return yield* Effect.fail(
						new LockCompromisedError({
							path: input.options.path,
							lockPath: input.options.lockPath,
							reason: 'refresh-overdue',
							cause: error.cause,
						}),
					)
				}
			}),
		),
	)

	yield* Deferred.succeed(input.ready, undefined)
	const refreshWhileHeld = Ref.get(input.releaseState).pipe(
		Effect.flatMap((state) => (state === 'held' ? refresh : Effect.void)),
	)
	yield* refreshWhileHeld.pipe(
		Effect.delay(input.options.updateMillis),
		Effect.forever,
		Effect.catchTag('LockCompromisedError', (error) => Deferred.fail(input.compromised, error)),
	)
})

export const ProperLockfileLive = Layer.succeed(
	ProperLockfile,
	(() => {
		const acquireProgram = Effect.fn('proper_lockfile.acquire')(function* (input: LockOptions) {
			const fileSystem = yield* FileSystem.FileSystem
			const options = yield* normalizeOptions(input).pipe(
				Effect.mapError(
					(cause) =>
						new LockAcquireError({
							path: input.path,
							lockPath: input.lockPath ?? `${input.path}.lock`,
							cause,
							message: 'Failed to resolve lock paths or options',
						}),
				),
			)

			const acquireWithRetry = acquireWithRetries(options).pipe(
				Effect.mapError((error) =>
					Match.value(error).pipe(
						Match.tag('LockAlreadyHeldError', (held) => held),
						Match.orElse(
							(cause) =>
								new LockAcquireError({
									path: options.path,
									lockPath: options.lockPath,
									cause,
									message: 'Failed to acquire the lock directory',
								}),
						),
					),
				),
			)

			const releaseResource = (
				resource: {
					readonly monitorFiber: Fiber.Fiber<void, never>
					readonly ownerPath: string
					readonly ownerId: string
					readonly releaseState: Ref.Ref<'held' | 'releasing' | 'released'>
				},
				reportAlreadyReleased: boolean,
			): Effect.Effect<void, LockReleaseFailure> =>
				Effect.uninterruptible(
					Ref.modify(
						resource.releaseState,
						(state) => [state, state === 'held' ? 'releasing' : state] as const,
					).pipe(
						Effect.flatMap((state): Effect.Effect<void, LockReleaseFailure> => {
							if (state !== 'held') {
								return reportAlreadyReleased
									? Effect.fail(
											new LockAlreadyReleasedError({
												path: options.path,
												lockPath: options.lockPath,
											}),
										)
									: Effect.void
							}
							return removeOwnedLock({
								path: options.path,
								lockPath: options.lockPath,
								ownerPath: resource.ownerPath,
								ownerId: resource.ownerId,
							}).pipe(
								// eslint-disable-next-line anti-slop/no-reprovide-ambient-service -- LockLease release retains the FileSystem used to acquire its specific lock.
								Effect.provideService(FileSystem.FileSystem, fileSystem),
								Effect.andThen(Fiber.interrupt(resource.monitorFiber)),
								Effect.asVoid,
								Effect.tap(() => Ref.set(resource.releaseState, 'released')),
								Effect.tapError(() => Ref.set(resource.releaseState, 'held')),
								Effect.catchTag('LockOperationError', (operationError) =>
									Effect.fail(
										new LockReleaseError({
											path: options.path,
											lockPath: options.lockPath,
											cause: operationError,
											message: 'Failed to read lock ownership during release',
										}),
									),
								),
							)
						}),
					),
				)

			const resource = yield* Effect.acquireRelease(
				Effect.gen(function* () {
					const acquired = yield* acquireWithRetry
					const compromised = yield* Deferred.make<never, LockCompromisedError>()
					const ready = yield* Deferred.make<void>()
					const releaseState = yield* Ref.make<'held' | 'releasing' | 'released'>('held')
					const monitorFiber = yield* monitorLock({
						options,
						...acquired,
						compromised,
						ready,
						releaseState,
					}).pipe(Effect.forkScoped)
					yield* Deferred.await(ready)
					return {
						acquiredAt: acquired.acquiredAt,
						failWhenLockOwnershipIsCompromised: Deferred.await(compromised),
						monitorFiber,
						ownerPath: acquired.ownerPath,
						ownerId: acquired.ownerId,
						releaseState,
					}
				}),
				(resource) =>
					releaseResource(resource, false).pipe(
						Effect.tapError((error) =>
							Effect.logError('Failed to release proper lockfile').pipe(
								Effect.annotateLogs({ lock_path: options.lockPath, error }),
							),
						),
						Effect.catchTags({
							LockAlreadyReleasedError: () => Effect.void,
							LockReleaseError: () => Effect.void,
						}),
					),
			)
			return {
				path: options.path,
				lockPath: options.lockPath,
				ownerId: resource.ownerId,
				acquiredAt: resource.acquiredAt,
				failWhenLockOwnershipIsCompromised: resource.failWhenLockOwnershipIsCompromised,
				release: releaseResource(resource, true),
			} satisfies LockLease
		})

		const checkProgram = Effect.fn('proper_lockfile.check')(function* (input: LockOptions) {
			const options = yield* normalizeOptions(input).pipe(
				Effect.mapError(
					(cause) =>
						new LockCheckError({
							path: input.path,
							lockPath: input.lockPath ?? `${input.path}.lock`,
							cause,
							message: 'Failed to resolve lock paths or options',
						}),
				),
			)
			return yield* lockIsStale(options).pipe(
				Effect.map((stale) => !stale),
				Effect.catchTag('LockMissingError', () => Effect.succeed(false)),
				Effect.catchTag('LockOperationError', (cause) =>
					Effect.fail(
						new LockCheckError({
							path: options.path,
							lockPath: options.lockPath,
							cause,
							message: 'Failed to inspect the lock directory',
						}),
					),
				),
			)
		})

		const withLock: ProperLockfileShape['withLock'] = (input, effect) =>
			Effect.scoped(
				Effect.gen(function* () {
					const lease = yield* acquireProgram(input)
					return yield* Effect.raceFirst(effect, lease.failWhenLockOwnershipIsCompromised)
				}),
			)

		return ProperLockfile.of({ acquire: acquireProgram, check: checkProgram, withLock })
	})(),
)
