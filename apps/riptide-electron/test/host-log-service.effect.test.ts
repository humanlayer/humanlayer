import * as NodePath from '@effect/platform-node/NodePath'
import { describe, expect, it } from '@effect/vitest'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'

import type { ElectronConfig } from '../src/config/electron-config'
import { HostLogService } from '../src/logging/host-log-service'
import { makeHostLogServiceLive } from '../src/logging/host-log-service.layer'

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
	logPath: '/test/logs/electron-local.log',
	daemonMode: 'external',
	protocolSchemes: ['humanlayer-electron-local'],
}

describe('HostLogService', () => {
	it.effect('returns the directory and reverse-sorted current log files', () =>
		Effect.gen(function* () {
			const service = yield* HostLogService
			expect(yield* service.getLogDirectory).toBe('/test/logs')
			expect(yield* service.getCurrentLogFiles).toEqual(['z.jsonl', 'b.log', 'a.log'])
		}).pipe(
			Effect.provide(makeHostLogServiceLive(config)),
			Effect.provide(
				FileSystem.layerNoop({
					readDirectory: () => Effect.succeed(['a.log', 'notes.txt', 'z.jsonl', 'b.log']),
				}),
			),
			Effect.provide(NodePath.layer),
		),
	)
})
