import { Context, type Effect, type Scope } from 'effect'

import type { DurableStreamsDiffProducerError, StreamInitializationError } from './errors'
import type { TaskDiffCaptureRequirements, TaskDiffPublication, TaskDiffWorkspace } from './types'

export interface DurableStreamsDiffProducer {
	readonly prepareCapture: Effect.Effect<TaskDiffCaptureRequirements, StreamInitializationError>
	readonly publishChanges: (publication: TaskDiffPublication) => Effect.Effect<void, DurableStreamsDiffProducerError>
	readonly completeCapture: Effect.Effect<void>
}

/** Creates a workspace-scoped publisher that owns both task-diff streams. */
export class DurableStreamsDiffProducerFactory extends Context.Service<
	DurableStreamsDiffProducerFactory,
	{
		readonly create: (
			workspace: TaskDiffWorkspace,
		) => Effect.Effect<DurableStreamsDiffProducer, StreamInitializationError, Scope.Scope>
	}
>()('DurableStreamsDiffProducerFactory') {}
