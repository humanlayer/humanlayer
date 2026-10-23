import { EventIcon } from '@humanlayer/ui/components/conversation-stream'

import type { RiptideStreamDB } from '@/collections/stream'
import { useSmoothAccumulatedThinkingContent } from '@/hooks/useSmoothAccumulatedTextContent'

import { AssistantMessageContent } from './AssistantMessageContent'

export function StreamingThinkingRow({
	conversationEventId,
	db,
	messageSeq: _messageSeq,
	blockSeq: _blockSeq,
}: {
	conversationEventId: string
	db: RiptideStreamDB
	messageSeq: number
	blockSeq: number
}) {
	const { content } = useSmoothAccumulatedThinkingContent(conversationEventId, db)

	if (!content) return null

	return (
		<div className="group p-4 transition-colors duration-200 border-l-2 relative border-l-transparent">
			<div className="flex items-start gap-4">
				<div className="flex-1 min-w-0">
					<div className="flex items-baseline gap-2">
						<span className="text-sm align-middle relative top-[1px] text-muted-foreground">
							<EventIcon type="thinking" role="assistant" size="md" isThinking />
						</span>
						<div className="flex-1 min-w-0 opacity-90">
							<AssistantMessageContent content={content} isThinking streaming />
						</div>
					</div>
				</div>
			</div>
		</div>
	)
}
