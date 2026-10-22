import { type ContextCompactionPayload, ContextCompactionRow } from '@humanlayer/ui/components/conversation-stream'
import { type FC, useCallback } from 'react'

import { useSessionDetail } from '@/components/session-detail/session-detail-context'
import { useExpansionStore } from '@/hooks/stores/expansionStore'
import { useFocusStore } from '@/hooks/stores/focusStore'

/** Compaction boundary row wired to its persisted summary and the shared focus/expansion stores. */
export const WiredContextCompactionRow: FC<{
	eventId: string
	payload: ContextCompactionPayload
	isFocused: boolean
	onFocusChange: (eventId: string | null, source: 'mouse' | 'keyboard') => void
	shouldIgnoreMouseEvent: () => boolean
}> = ({ eventId, payload, isFocused, onFocusChange, shouldIgnoreMouseEvent }) => {
	const { conversation } = useSessionDetail()
	const summary = conversation.compactionSummaries.get(eventId)
	const isEditorFocused = useFocusStore((state) => state.isEditorFocused)
	const isSummaryExpanded = useExpansionStore((state) => state.expandedCompactions.has(eventId))
	const handleToggleSummary = useCallback(() => useExpansionStore.getState().toggleCompaction(eventId), [eventId])
	const handleMouseEnter = useCallback(() => {
		if (shouldIgnoreMouseEvent()) return
		onFocusChange(eventId, 'mouse')
	}, [eventId, onFocusChange, shouldIgnoreMouseEvent])
	const handleMouseLeave = useCallback(() => {
		if (shouldIgnoreMouseEvent()) return
		onFocusChange(null, 'mouse')
	}, [onFocusChange, shouldIgnoreMouseEvent])
	return (
		<ContextCompactionRow
			eventId={eventId}
			payload={payload}
			isFocused={isFocused}
			isEditorFocused={isEditorFocused}
			summary={summary}
			isSummaryExpanded={isSummaryExpanded}
			onToggleSummary={summary === undefined ? undefined : handleToggleSummary}
			onMouseEnter={handleMouseEnter}
			onMouseLeave={handleMouseLeave}
		/>
	)
}
