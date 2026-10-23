import type { SDKPartialAssistantMessage } from '@anthropic-ai/claude-agent-sdk'
import { Effect } from 'effect'

import type { StreamProducerService } from '../../effects/services/stream-producer/stream-producer.service'

type ClaudeStreamEvent = SDKPartialAssistantMessage['event']

export const handleClaudeStreamEvent = (event: ClaudeStreamEvent, producer: StreamProducerService) => {
	switch (event.type) {
		case 'message_start':
			return producer.writeMessageStart()
		case 'content_block_start':
			if (event.content_block.type === 'text') {
				return producer.startTextBlock(event.index).pipe(Effect.asVoid)
			}
			if (event.content_block.type === 'thinking') {
				return producer.startThinkingBlock(event.index).pipe(Effect.asVoid)
			}
			return Effect.void
		case 'content_block_delta':
			if (event.delta.type === 'text_delta') {
				return producer.writeTextDelta(event.delta.text)
			}
			if (event.delta.type === 'thinking_delta') {
				return producer.writeThinkingDelta(event.delta.thinking)
			}
			return Effect.void
		case 'content_block_stop':
			return producer.writeContentBlockStop(event.index)
		case 'message_stop':
			return producer.writeMessageStop()
		default:
			return Effect.void
	}
}
