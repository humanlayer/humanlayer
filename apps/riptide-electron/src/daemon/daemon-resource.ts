import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Path from 'effect/Path'

import type { ElectronConfig } from '../config/electron-config'
import { ElectronPlatform } from '../platform/electron-platform.service'
import { DaemonGenerationError, DaemonUnavailableError } from './daemon.errors'

export const resolveDaemonExecutable = Effect.fn('daemon_supervisor.resolve_executable')(function* (input: {
	readonly config: ElectronConfig
}) {
	const daemonMode = input.config.daemonMode
	if (daemonMode === 'external') {
		return yield* Effect.fail(
			new DaemonUnavailableError({ message: 'Electron does not own the daemon in ordinary development' }),
		)
	}
	const fileSystem = yield* FileSystem.FileSystem
	const pathService = yield* Path.Path
	const platform = yield* ElectronPlatform
	const executablePath =
		daemonMode === 'packaged'
			? pathService.join(platform.resourcesPath, 'bin', 'riptided')
			: input.config.stagedDaemonPath
	if (executablePath === undefined) {
		return yield* Effect.fail(
			new DaemonUnavailableError({ message: 'RIPTIDE_ELECTRON_STAGED_DAEMON_PATH is required in staged mode' }),
		)
	}
	const exists = yield* fileSystem
		.exists(executablePath)
		.pipe(
			Effect.mapError(
				(cause) => new DaemonGenerationError({ cause, message: 'Failed to inspect the daemon executable' }),
			),
		)
	if (!exists) {
		return yield* Effect.fail(
			new DaemonUnavailableError({ message: `Daemon executable not found: ${executablePath}` }),
		)
	}
	return executablePath
})
