import { HostIdPersistenceError } from '@humanlayer/riptide-electron-rpc'
import * as Crypto from 'effect/Crypto'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Path from 'effect/Path'
import * as Semaphore from 'effect/Semaphore'

import type { ElectronConfig } from '../config/electron-config'
import { Sentry } from '../instrument'
import { HostIdService } from './host-id-service'

export const makeHostIdServiceLive = (config: ElectronConfig) =>
	Layer.effect(
		HostIdService,
		Effect.gen(function* () {
			const crypto = yield* Crypto.Crypto
			const fileSystem = yield* FileSystem.FileSystem
			const pathService = yield* Path.Path
			// Resolve the SAME host_id file the daemon and the Tauri host use, so a
			// daemon running on this machine is detected as colocated (not remote).
			// Must mirror apps/riptide-daemon/src/lib/host-id.ts and
			// apps/riptide-native/src/daemon.rs (get_host_id_path):
			//   ~/.humanlayer/riptide/host_id            (default)
			//   ~/.humanlayer/riptide/host_id_<DEVSTACK_ID>  (when DEVSTACK_ID is set)
			const hostIdDirectory = pathService.join(config.homeDirectory, '.humanlayer', 'riptide')
			const hostIdPath = pathService.join(
				hostIdDirectory,
				config.devstackId ? `host_id_${config.devstackId}` : 'host_id',
			)
			const initializationSemaphore = yield* Semaphore.make(1)
			let cachedHostId: string | undefined

			const loadOrCreateHostId = Effect.gen(function* () {
				const existingHostId = yield* fileSystem.readFileString(hostIdPath, 'utf8').pipe(
					Effect.map((contents) => contents.trim()),
					Effect.catchTag('PlatformError', (error) =>
						Match.value(error.reason).pipe(
							Match.when({ _tag: 'NotFound' }, () => Effect.succeed('')),
							Match.orElse(() => Effect.fail(error)),
						),
					),
				)
				if (existingHostId.length > 0) return existingHostId

				const createdHostId = yield* crypto.randomUUIDv4
				yield* fileSystem.makeDirectory(pathService.dirname(hostIdPath), { recursive: true })
				yield* fileSystem.writeFileString(hostIdPath, `${createdHostId}\n`, { mode: 0o600 })
				return createdHostId
			}).pipe(
				Effect.tapError((e) => Effect.logError(e)),
				Effect.tapError((e) => Effect.sync(() => Sentry.captureException(e))),
				Effect.mapError((error) => new HostIdPersistenceError({ message: error.message })),
			)

			const get = initializationSemaphore
				.withPermit(
					Effect.suspend(() => {
						if (cachedHostId !== undefined) return Effect.succeed(cachedHostId)

						return loadOrCreateHostId.pipe(
							Effect.tap((hostId) =>
								Effect.sync(() => {
									cachedHostId = hostId
								}),
							),
						)
					}),
				)
				.pipe(Effect.withSpan('host_id.get'))

			return HostIdService.of({ get })
		}),
	)
