import type { ConversationEvent } from '@humanlayer/ui/components/conversation-stream'
import { parseContextCompaction } from '@humanlayer/ui/components/conversation-stream'
import { COMPACT_COMMAND } from '@humanlayer/ui/constants/system-slash-commands'

export const COMPACTED_HISTORY_PAGE_SIZE = 25

export interface CompactedHistory {
	boundaryEventId: string
	foldedCount: number
}

export const compactedHistoryId = (boundaryEventId: string) => `compacted-${boundaryEventId}`

const compactCommandPattern = new RegExp(`^\\s*${COMPACT_COMMAND}(?:\\s|$)`)

const isCompactCommandMessage = (event: ConversationEvent) =>
	event.eventType === 'message' && event.role === 'user' && compactCommandPattern.test(event.content ?? '')

/**
 * Root events the latest compaction folded away, keeping the `/compact` message
 * that triggered it visible as the fold's anchor. Null when the session was
 * never compacted or nothing precedes the boundary.
 */
export function getCompactedHistory(rootEvents: ConversationEvent[]): CompactedHistory | null {
	for (let index = rootEvents.length - 1; index >= 0; index--) {
		const event = rootEvents[index]
		if (event === undefined || parseContextCompaction(event) === null) continue
		const previous = rootEvents[index - 1]
		const foldedCount = previous !== undefined && isCompactCommandMessage(previous) ? index - 1 : index
		return foldedCount > 0 ? { boundaryEventId: event.id, foldedCount } : null
	}
	return null
}

export function revealedHistoryStart(history: CompactedHistory, revealCount: number | undefined): number {
	const count = Math.max(1, Math.trunc(revealCount ?? COMPACTED_HISTORY_PAGE_SIZE))
	return Math.max(0, history.foldedCount - count)
}
