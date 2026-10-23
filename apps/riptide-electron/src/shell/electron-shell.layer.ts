import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { shell } from 'electron'

import { ElectronShell, ElectronShellFailure } from './electron-shell.service'

export const ElectronShellLive = Layer.succeed(
	ElectronShell,
	ElectronShell.of({
		openExternal: ({ url }) =>
			Effect.tryPromise({
				try: () => shell.openExternal(url),
				catch: (cause) =>
					new ElectronShellFailure({
						cause,
						message: cause instanceof Error ? cause.message : String(cause),
					}),
			}).pipe(Effect.asVoid),
	}),
)
