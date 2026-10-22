import { ProperLockfile } from '@humanlayer/effect-proper-lockfile'
import { DaemonLockOwner, type DaemonLeaseIdentity } from '@humanlayer/schemas/effect/daemon/identity'
import * as Config from 'effect/Config'
import * as Crypto from 'effect/Crypto'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Path from 'effect/Path'

import type { AcquireDaemonInstanceLockInput } from './daemon-instance-lock.service'
import { DaemonInstanceLeaseState, DaemonInstanceLock } from './daemon-instance-lock.service'
import { DaemonInstanceAlreadyRunning, DaemonInstanceLockError } from './errors'
import { acquireReleasedOnProcessExit } from './release-on-process-exit'

const bytesToHex = (bytes: Uint8Array): string =>
	Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')

export const DaemonInstanceLockLive = Layer.effect(
	DaemonInstanceLock,
	Effect.gen(function* () {
		const crypto = yield* Crypto.Crypto
		const fileSystem = yield* FileSystem.FileSystem
		const pathService = yield* Path.Path
		const properLockfile = yield* ProperLockfile
		const homeDirectory = yield* Config.String('HOME')

		const acquire = Effect.fn('daemon_instance_lock.acquire')(function* (
			input: DaemonLeaseIdentity & {
				readonly generationId: string | null
			},
		) {
			const tupleBytes = new TextEncoder().encode(
				`${input.userId}\u0000${input.organizationId}\u0000${input.hostId}\u0000${input.stage}`,
			)
			const tupleHash = bytesToHex(
				yield* crypto
					.digest('SHA-256', tupleBytes)
					.pipe(
						Effect.mapError(
							(cause) =>
								new DaemonInstanceLockError({ cause, message: 'Failed to hash daemon identity' }),
						),
					),
			)
			const lockDirectory = pathService.join(homeDirectory, '.humanlayer', 'riptide', 'daemon-locks')
			const lockPath = pathService.join(lockDirectory, `${tupleHash}.lock`)
			yield* fileSystem
				.makeDirectory(lockDirectory, { recursive: true })
				.pipe(
					Effect.mapError(
						(cause) =>
							new DaemonInstanceLockError({ cause, message: 'Failed to create daemon lock directory' }),
					),
				)

			const lease = yield* acquireReleasedOnProcessExit(
				properLockfile.acquire({
					path: lockDirectory,
					lockPath,
					realPath: false,
					stale: '30 seconds',
					updateInterval: '5 seconds',
					retries: 7,
					retryDelay: '5 seconds',
					ownerMetadata: DaemonLockOwner.make({
						pid: process.pid,
						userId: input.userId,
						organizationId: input.organizationId,
						hostId: input.hostId,
						stage: input.stage,
						generationId: input.generationId,
					}),
				}),
			).pipe(
				Effect.mapError((error) =>
					Match.value(error).pipe(
						Match.tag(
							'LockAlreadyHeldError',
							(held) =>
								new DaemonInstanceAlreadyRunning({
									userId: input.userId,
									organizationId: input.organizationId,
									hostId: input.hostId,
									stage: input.stage,
									lockPath: held.lockPath,
								}),
						),
						Match.orElse(
							(cause) =>
								new DaemonInstanceLockError({
									cause,
									message: 'Failed to acquire daemon instance lock',
								}),
						),
					),
				),
			)

			return {
				lockPath: lease.lockPath,
				monitorCompromise: lease.failWhenLockOwnershipIsCompromised,
			}
		})

		return DaemonInstanceLock.of({ acquire })
	}),
)

export const makeActiveDaemonInstanceLeaseLive = (input: AcquireDaemonInstanceLockInput) =>
	Layer.effect(
		DaemonInstanceLeaseState,
		DaemonInstanceLock.use((instanceLock) => instanceLock.acquire(input)).pipe(
			Effect.map((lease) => ({ mode: 'active' as const, lease })),
			Effect.withSpan('daemon_instance_lock.acquire_active_lease', {
				attributes: {
					organization_id: input.organizationId,
					host_id: input.hostId,
					stage: input.stage,
				},
			}),
		),
	)
