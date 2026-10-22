import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'

/** A fresh, complete native environment for a child process, not scalar configuration. */
export class InheritedEnvironment extends Context.Service<
	InheritedEnvironment,
	{
		readonly snapshot: Effect.Effect<Record<string, string>>
	}
>()('InheritedEnvironment') {}
