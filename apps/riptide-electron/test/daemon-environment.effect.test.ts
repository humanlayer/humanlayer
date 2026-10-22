import { describe, it } from '@effect/vitest'
import { ConfigProvider, Effect, Layer, Redacted, Sink, Stream } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import { expect } from 'vitest'

import { buildDaemonEnvironment } from '../src/daemon/daemon-environment'
import { InheritedEnvironment } from '../src/platform/inherited-environment'

const request = {
	token: Redacted.make('new-identity'),
	generationId: 'generation',
	channel: 'local' as const,
	apiOrigin: 'https://request-api.test',
	syncOrigin: 'https://request-sync.test',
	expectedIdentity: { userId: 'user', organizationId: 'org', hostId: 'host' },
	verifiedClaudePath: '/verified/claude',
}

const shellLayer = (exitCode: number) =>
	Layer.succeed(
		ChildProcessSpawner.ChildProcessSpawner,
		ChildProcessSpawner.make((command) =>
			Effect.sync(() => {
				expect(ChildProcess.isStandardCommand(command)).toBe(true)
				if (!ChildProcess.isStandardCommand(command)) throw new Error('Unexpected piped command')
				expect(command.command).toBe('/fixture/shell')
				expect(command.args).toEqual(['-il', '-c', 'command env -0'])
				const stdout = Stream.make(
					new TextEncoder().encode(
						'PATH=/shell:/shared\0CONFLICT=shell\0SHELL_ONLY=yes\0DEVSTACK_ID=shell\0RIPTIDE_API_ORIGIN=shell\0DAEMON_IDENTITY=stale-shell\0',
					),
				)
				return ChildProcessSpawner.makeHandle({
					pid: ChildProcessSpawner.ProcessId(1),
					exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(exitCode)),
					isRunning: Effect.succeed(false),
					kill: () => Effect.void,
					stdin: Sink.drain,
					stdout,
					stderr: Stream.empty,
					all: stdout,
					getInputFd: () => Sink.drain,
					getOutputFd: () => Stream.empty,
					unref: Effect.succeed(Effect.void),
				})
			}),
		),
	)

describe('daemon inherited environment', () => {
	for (const shellExitCode of [0, 1]) {
		it.effect(`preserves merge order and fresh forwarding when shell exits ${shellExitCode}`, () => {
			let snapshots = 0
			return Effect.gen(function* () {
				const environment = yield* buildDaemonEnvironment(request)
				expect(snapshots).toBe(shellExitCode === 0 ? 2 : 3)
				expect(environment).toMatchObject({
					UNKNOWN_INHERITED: 'kept',
					CONFLICT: shellExitCode === 0 ? 'shell' : 'electron',
					PATH: shellExitCode === 0 ? '/shell:/shared:/electron' : '/electron:/shared',
					DEVSTACK_ID: `electron-${snapshots}`,
					RIPTIDE_API_ORIGIN: request.apiOrigin,
					RIPTIDE_SYNC_ORIGIN: request.syncOrigin,
					DAEMON_IDENTITY: 'new-identity',
					RIPTIDE_DAEMON_EXPECTED_IDENTITY: JSON.stringify(request.expectedIdentity),
					HUMANLAYER_CLAUDE_PATH: '/verified/claude',
					RIPTIDE_DAEMON_GENERATION_ID: 'generation',
					RIPTIDE_DAEMON_CHANNEL: 'local',
					RIPTIDE_DAEMON_USE_ORPHAN_DETECTION: '1',
					NODE_USE_SYSTEM_CA: '1',
					BUN_CONFIG_MAX_HTTP_REQUESTS: '1000',
				})
			}).pipe(
				Effect.provide(
					Layer.mergeAll(
						shellLayer(shellExitCode),
						ConfigProvider.layer(ConfigProvider.fromUnknown({ SHELL: '/fixture/shell' })),
						Layer.succeed(InheritedEnvironment, {
							snapshot: Effect.sync(() => {
								snapshots++
								return {
									UNKNOWN_INHERITED: 'kept',
									CONFLICT: 'electron',
									PATH: '/electron:/shared',
									DEVSTACK_ID: `electron-${snapshots}`,
									RIPTIDE_API_ORIGIN: 'electron',
									DAEMON_IDENTITY: 'stale-native',
									RIPTIDE_DAEMON_EXPECTED_IDENTITY: 'stale-native',
								}
							}),
						}),
					),
				),
			)
		})
	}
})
