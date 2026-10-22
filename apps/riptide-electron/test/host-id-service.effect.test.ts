import * as NodePath from '@effect/platform-node/NodePath'
import { describe, expect, it } from '@effect/vitest'
import * as Crypto from 'effect/Crypto'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'

import type { ElectronConfig } from '../src/config/electron-config'
import { HostIdService } from '../src/host/host-id-service'
import { makeHostIdServiceLive } from '../src/host/host-id-service.layer'

const persistedHostId = '01c33ef3-1aa9-4740-89fc-407118590020'
const config: ElectronConfig = {
	channel: 'local',
	isPackaged: false,
	userDataPath: '/test/profile',
	homeDirectory: '/test/home',
	devstackId: undefined,
	rendererUrl: new URL('http://localhost:3000'),
	applicationIconPath: undefined,
	remoteDebuggingPort: 9222,
	cdpEnabled: false,
	openDevTools: false,
	logPath: '/test/electron.log',
	daemonMode: 'external',
	protocolSchemes: ['humanlayer-electron-local'],
}

const hostIdDependencies = (fileSystem: Layer.Layer<FileSystem.FileSystem>) =>
	Layer.mergeAll(
		fileSystem,
		NodePath.layer,
		Layer.succeed(
			Crypto.Crypto,
			Crypto.make({
				randomBytes: (size) => new Uint8Array(size),
				digest: (_algorithm, data) => Effect.succeed(data),
			}),
		),
	)

describe('HostIdService', () => {
	it.effect('loads and caches a persisted host ID through the filesystem service', () => {
		let reads = 0
		const fileSystem = FileSystem.layerNoop({
			readFileString: () =>
				Effect.sync(() => {
					reads += 1
					return `${persistedHostId}\n`
				}),
		})
		const layer = makeHostIdServiceLive(config).pipe(Layer.provide(hostIdDependencies(fileSystem)))

		return Effect.gen(function* () {
			const service = yield* HostIdService
			const first = yield* service.get
			const second = yield* service.get

			expect(first).toBe(persistedHostId)
			expect(second).toBe(persistedHostId)
			expect(reads).toBe(1)
		}).pipe(Effect.provide(layer))
	})

	it.effect('creates a missing host ID with private file permissions', () => {
		const writes: Array<{ readonly path: string; readonly data: string; readonly mode: number | undefined }> = []
		const fileSystem = FileSystem.layerNoop({
			makeDirectory: () => Effect.void,
			writeFileString: (path, data, options) =>
				Effect.sync(() => {
					writes.push({ path, data, mode: options?.mode })
				}),
		})
		const layer = makeHostIdServiceLive(config).pipe(Layer.provide(hostIdDependencies(fileSystem)))

		return Effect.gen(function* () {
			const service = yield* HostIdService
			const hostIds = yield* Effect.all([service.get, service.get], { concurrency: 'unbounded' })
			const hostId = hostIds[0]

			expect(hostIds).toEqual([hostId, hostId])
			expect(hostId).toBe('00000000-0000-4000-8000-000000000000')
			expect(writes).toEqual([
				{ path: '/test/home/.humanlayer/riptide/host_id', data: `${hostId}\n`, mode: 0o600 },
			])
		}).pipe(Effect.provide(layer))
	})

	it.effect('resolves the devstack-suffixed host_id file when a devstack id is set', () => {
		const writes: Array<{ readonly path: string; readonly data: string; readonly mode: number | undefined }> = []
		const fileSystem = FileSystem.layerNoop({
			makeDirectory: () => Effect.void,
			writeFileString: (path, data, options) =>
				Effect.sync(() => {
					writes.push({ path, data, mode: options?.mode })
				}),
		})
		const devstackConfig: ElectronConfig = { ...config, devstackId: 'my-stack' }
		const layer = makeHostIdServiceLive(devstackConfig).pipe(Layer.provide(hostIdDependencies(fileSystem)))

		return Effect.gen(function* () {
			const service = yield* HostIdService
			yield* service.get

			expect(writes.map((write) => write.path)).toEqual(['/test/home/.humanlayer/riptide/host_id_my-stack'])
		}).pipe(Effect.provide(layer))
	})
})
