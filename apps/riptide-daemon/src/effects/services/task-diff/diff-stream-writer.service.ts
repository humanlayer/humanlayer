import { Context, type Effect, type Scope } from 'effect'

import type { StreamAppendError, StreamFlushError, StreamInitializationError } from './errors'
import type { TaskDiffWorkspace } from './types'

export interface DiffStreamWriter {
	readonly append: (event: string) => Effect.Effect<void, StreamAppendError>
	readonly flush: Effect.Effect<void, StreamFlushError>
}

export interface DiffStreamAvailability {
	readonly versionsExist: boolean
	readonly filesExist: boolean
}

export interface DiffStreamWriterPair {
	readonly versions: DiffStreamWriter
	readonly files: DiffStreamWriter
	readonly checkTaskDiffStreamExistence: Effect.Effect<DiffStreamAvailability, StreamInitializationError>
}

/** Isolates the external Durable Streams SDK behind a replaceable Effect service. */
export class DiffStreamWriterFactory extends Context.Service<
	DiffStreamWriterFactory,
	{
		readonly create: (
			workspace: TaskDiffWorkspace,
		) => Effect.Effect<DiffStreamWriterPair, StreamInitializationError, Scope.Scope>
	}
>()('DiffStreamWriterFactory') {}
