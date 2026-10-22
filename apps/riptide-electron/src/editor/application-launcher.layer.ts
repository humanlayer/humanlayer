import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'

import { ApplicationLauncher, ApplicationLaunchFailure } from './application-launcher.service'

export const ApplicationLauncherLive = Layer.effect(
	ApplicationLauncher,
	Effect.gen(function* () {
		const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner

		const openPath = Effect.fn('application_launcher.open_path')(function* (input: {
			readonly path: string
			readonly applicationName: string | null
		}) {
			const args = input.applicationName === null ? [input.path] : ['-a', input.applicationName, input.path]
			const command = ChildProcess.make('/usr/bin/open', args, {
				detached: true,
				stdin: 'ignore',
				stdout: 'ignore',
				stderr: 'ignore',
			})

			yield* Effect.scoped(
				childProcessSpawner.spawn(command).pipe(
					Effect.flatMap((handle) => handle.unref),
					Effect.asVoid,
				),
			).pipe(Effect.mapError((cause) => new ApplicationLaunchFailure({ cause, message: cause.message })))
		})

		return ApplicationLauncher.of({ openPath })
	}),
)
