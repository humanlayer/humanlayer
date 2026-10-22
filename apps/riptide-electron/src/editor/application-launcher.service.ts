import * as Context from 'effect/Context'
import * as Data from 'effect/Data'
import type * as Effect from 'effect/Effect'

export class ApplicationLaunchFailure extends Data.TaggedError('ApplicationLaunchFailure')<{
	readonly cause: unknown
	readonly message: string
}> {}

export interface ApplicationLauncherShape {
	readonly openPath: (input: {
		readonly path: string
		readonly applicationName: string | null
	}) => Effect.Effect<void, ApplicationLaunchFailure>
}

export class ApplicationLauncher extends Context.Service<ApplicationLauncher, ApplicationLauncherShape>()(
	'ApplicationLauncher',
) {}
