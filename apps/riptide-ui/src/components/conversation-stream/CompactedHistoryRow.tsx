import { ChevronDown } from 'lucide-react'
import type { FC } from 'react'

import { useExpansionStore } from '@/hooks/stores/expansionStore'
import { useFocusStore } from '@/hooks/stores/focusStore'
import { cn } from '@/lib/utils'
import { COMPACTED_HISTORY_PAGE_SIZE } from '@/utils/compacted-history'

/**
 * Collapsed header standing in for the events a context compaction summarized
 * away. Expanding (click or h/l) reveals the newest page of them below it, up to
 * the boundary row; older events stay truncated until "Show older" is pressed.
 */
export const CompactedHistoryRow: FC<{
	/** Expansion/focus id (`compacted-<boundary event id>`). */
	id: string
	eventCount: number
	/** Newest folded events currently rendered below the header. */
	revealedCount: number
	isExpanded: boolean
}> = ({ id, eventCount, revealedCount, isExpanded }) => {
	const isFocused = useFocusStore((s) => s.focusedEventId === id)
	const isEditorFocused = useFocusStore((s) => s.isEditorFocused)
	const isTruncated = isExpanded && revealedCount < eventCount
	const nextPageSize = Math.min(COMPACTED_HISTORY_PAGE_SIZE, eventCount - revealedCount)

	const handleToggle = () => {
		useExpansionStore.getState().toggleCompaction(id)
	}
	const reveal = (count: number) => {
		useExpansionStore.getState().setCompactionRevealCount(id, count)
	}
	const ignoreMouse = () => useFocusStore.getState().focusSource === 'keyboard'
	const handleMouseEnter = () => {
		if (ignoreMouse()) return
		useFocusStore.getState().setFocusedEventId(id, 'mouse')
	}
	const handleMouseLeave = () => {
		if (ignoreMouse()) return
		useFocusStore.getState().clearFocus()
	}

	return (
		<div
			className={cn(
				'group border-l-2 px-4 py-3 transition-colors duration-200',
				isFocused
					? cn('bg-accent/5', isEditorFocused ? 'border-l-transparent' : 'border-l-[var(--terminal-accent)]')
					: 'border-l-transparent hover:bg-muted/10',
			)}
			data-event-id={id}
			onMouseEnter={handleMouseEnter}
			onMouseLeave={handleMouseLeave}
		>
			<button
				type="button"
				aria-expanded={isExpanded}
				onClick={handleToggle}
				className="flex w-full cursor-pointer items-center gap-2 text-left text-xs uppercase tracking-wider text-muted-foreground"
			>
				<ChevronDown className={cn('h-3 w-3 transition-transform', !isExpanded && '-rotate-90')} />
				<span>
					<span className="normal-case">{eventCount.toLocaleString()}</span>{' '}
					{eventCount === 1 ? 'event' : 'events'} compacted
				</span>
				{isTruncated && (
					<span className="text-muted-foreground/60 normal-case tracking-normal">
						· showing last {revealedCount.toLocaleString()}
					</span>
				)}
			</button>
			{isTruncated && (
				<div className="flex items-center gap-3 pl-5 pt-1 text-xs">
					<button
						type="button"
						className="text-[var(--terminal-accent)] hover:underline"
						onClick={() => reveal(revealedCount + COMPACTED_HISTORY_PAGE_SIZE)}
					>
						Show {nextPageSize.toLocaleString()} older
					</button>
					<button
						type="button"
						className="text-muted-foreground hover:underline"
						onClick={() => reveal(eventCount)}
					>
						Show all
					</button>
				</div>
			)}
		</div>
	)
}
