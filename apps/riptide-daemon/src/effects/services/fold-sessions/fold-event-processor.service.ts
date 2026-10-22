import { Context, type Effect } from 'effect'

import type { StreamProducer } from '../stream-producer/stream-producer.service'
import type { FoldEventProcessingError } from './fold-sessions.errors'
import type { ProcessFoldEventInput } from './fold-sessions.schemas'

export class FoldEventProcessor extends Context.Service<
	FoldEventProcessor,
	{
		readonly processEmittedEvent: (
			input: ProcessFoldEventInput,
		) => Effect.Effect<void, FoldEventProcessingError, StreamProducer>
	}
>()('FoldEventProcessor') {}
