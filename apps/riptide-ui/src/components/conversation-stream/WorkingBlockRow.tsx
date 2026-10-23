import { AgentPreview, type ConversationEvent, StatusBadge } from '@humanlayer/ui/components/conversation-stream'
import { ChevronDown } from 'lucide-react'
import type { FC } from 'react'

import { useExpansionStore } from '@/hooks/stores/expansionStore'
import { useFocusStore } from '@/hooks/stores/focusStore'
import { cn } from '@/lib/utils'

/** One subagent launched inside a working block — rendered as a tree line under the header. */
export interface WorkingBlockAgentLine {
	eventId: string
	name: string
	description: string
	isCompleted: boolean
	hasPendingApproval: boolean
}

/** A contiguous run of thinking/tool-call root events collapsed into one row. */
export interface WorkingBlock {
	/** Stable id (`work-<first event id>`); also used as the focus/navigation id. */
	id: string
	events: ConversationEvent[]
	toolCallCount: number
	durationMs: number
	latestToolCall: ConversationEvent | null
	agentLines: WorkingBlockAgentLine[]
	hasPendingApproval: boolean
}

function formatWorkedDuration(ms: number): string {
	const totalSeconds = Math.max(1, Math.round(ms / 1000))
	if (totalSeconds < 60) return `${totalSeconds}s`
	const minutes = Math.floor(totalSeconds / 60)
	return `${minutes}m ${totalSeconds % 60}s`
}

/**
 * Collapsed header for a "working" block: a subtle one-liner ("Worked for Ns"),
 * the live latest tool call while the tail block is still running, and one tree
 * line per subagent. Expanding (click or h/l) reveals the constituent rows in
 * the same nested style as expanded agent groups.
 */
export const WorkingBlockRow: FC<{
	block: WorkingBlock
	isExpanded: boolean
	/** True for the tail block of a running session — renders "Working…" plus the live tool call. */
	isActive: boolean
	shouldIgnoreMouseEvent?: () => boolean
}> = ({ block, isExpanded, isActive, shouldIgnoreMouseEvent }) => {
	const isFocused = useFocusStore((s) => s.focusedEventId === block.id)
	const isEditorFocused = useFocusStore((s) => s.isEditorFocused)

	const handleToggle = () => {
		// Blocks with a pending approval are forced open so the approval UI stays actionable.
		if (block.hasPendingApproval) return
		useExpansionStore.getState().toggleWorkBlock(block.id)
	}
	// Same guard as the other row types: while keyboard navigation owns focus,
	// rows shifting under a stationary cursor must not steal or clear it.
	const ignoreMouse = shouldIgnoreMouseEvent ?? (() => useFocusStore.getState().focusSource === 'keyboard')
	const handleMouseEnter = () => {
		if (ignoreMouse()) return
		useFocusStore.getState().setFocusedEventId(block.id, 'mouse')
	}
	const handleMouseLeave = () => {
		if (ignoreMouse()) return
		useFocusStore.getState().clearFocus()
	}

	return (
		<div
			className={cn(
				'group cursor-pointer border-l-2 px-4 py-3 transition-colors duration-200',
				// hover bg only while unfocused: :hover outranks the focus bg class,
				// so a cursor resting over the focused row would wipe its highlight.
				isFocused
					? cn('bg-accent/5', isEditorFocused ? 'border-l-transparent' : 'border-l-[var(--terminal-accent)]')
					: 'border-l-transparent hover:bg-muted/10',
			)}
			data-event-id={block.id}
			role="button"
			aria-expanded={isExpanded}
			onClick={handleToggle}
			onMouseEnter={handleMouseEnter}
			onMouseLeave={handleMouseLeave}
		>
			<div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
				<ChevronDown className={cn('h-3 w-3 transition-transform', !isExpanded && '-rotate-90')} />
				<span>
					{isActive ? (
						'Working…'
					) : (
						<>
							Worked for <span className="normal-case">{formatWorkedDuration(block.durationMs)}</span>
						</>
					)}
				</span>
				{!isExpanded && block.toolCallCount > 0 && (
					<span className="text-muted-foreground/60 normal-case tracking-normal">
						· {block.toolCallCount} tool call{block.toolCallCount !== 1 ? 's' : ''}
					</span>
				)}
			</div>

			{/* Live preview of the most recent tool call while the block is still running */}
			{isActive && !isExpanded && block.latestToolCall && (
				<div className="pl-5 pt-1">
					<AgentPreview latestEvent={block.latestToolCall} toolCallCount={block.toolCallCount} />
				</div>
			)}

			{/* One tree line per subagent launched inside this block */}
			{!isExpanded && block.agentLines.length > 0 && (
				<div className="flex flex-col gap-0.5 pl-5 pt-1">
					{block.agentLines.map((line, index) => (
						<div
							key={line.eventId}
							className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"
						>
							<span className="shrink-0 text-muted-foreground/50">
								{index === block.agentLines.length - 1 ? '└' : '├'}
							</span>
							<span className="shrink-0 text-[var(--terminal-accent)]">{line.name}</span>
							{line.description && <span className="truncate">{line.description}</span>}
							{!line.isCompleted && line.hasPendingApproval ? (
								<StatusBadge status="pending" />
							) : !line.isCompleted && isActive ? (
								<StatusBadge status="groupRunning" />
							) : null}
						</div>
					))}
				</div>
			)}
		</div>
	)
}
