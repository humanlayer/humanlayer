import type { AgentEvent } from '@humanlayer/agentlayer-core'
import { Effect } from 'effect'

import type { StreamProducerService } from '../../effects/services/stream-producer/stream-producer.service'

const isChildAgentEvent = (event: AgentEvent) => !!event.agentId || !!event.parentToolCallId

export const handleCodelayerStreamEvent = (event: AgentEvent, producer: StreamProducerService) => {
	if (isChildAgentEvent(event)) return Effect.void

	switch (event.type) {
		case 'textStart':
		case 'reasoningStart':
		case 'toolInputStart':
		case 'toolInputDelta':
		case 'toolInputEnd':
			return Effect.void
		case 'textDelta':
			return event.text.length === 0
				? Effect.void
				: (producer.writeTextDeltaForSource?.({ sourceBlockId: event.id, content: event.text }) ??
						producer.writeTextDelta(event.text))
		case 'reasoningDelta':
			return event.text.length === 0
				? Effect.void
				: (producer.writeThinkingDeltaForSource?.({ sourceBlockId: event.id, content: event.text }) ??
						producer.writeThinkingDelta(event.text))
		case 'textEnd':
		case 'reasoningEnd':
			return producer.writeContentBlockStopForSource?.({ sourceBlockId: event.id }) ?? Effect.void
		default:
			return Effect.void
	}
}
