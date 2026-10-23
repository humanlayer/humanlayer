import { type SessionLabel, SessionLabelBadge } from '@humanlayer/ui/components/session-label-badge'
import { SyncGridAnimation } from '@humanlayer/ui/components/sync-grid-animation'
import { cn } from '@humanlayer/ui/lib/utils'
import { ArrowRight, ChevronRight, List, MessageCircleQuestion, TriangleAlert } from 'lucide-react'
import type { FC } from 'react'

export type TaskStatus =
	| 'needs_approval'
	| 'failed'
	| 'lost'
	| 'running'
	| 'pending'
	| 'interrupt_requested'
	| 'has_next_step'
	| 'idle'

export interface MobileTaskRowProps {
	taskId: string
	taskName: string
	label?: SessionLabel
	sessionCount: number
	status: TaskStatus
	onClick: () => void
}

function renderTaskStatusIndicator(status: TaskStatus) {
	switch (status) {
		case 'needs_approval':
			return (
				<MessageCircleQuestion
					className="w-4 h-4 text-[var(--terminal-warning)] animate-pulse-warning"
					strokeWidth={2}
				/>
			)
		case 'failed':
			return (
				<TriangleAlert className="w-4 h-4 text-[var(--terminal-error)] animate-pulse-error" strokeWidth={2} />
			)
		case 'lost':
			return <TriangleAlert className="w-4 h-4 text-[var(--terminal-warning)]" strokeWidth={2} />
		case 'running':
			return (
				<SyncGridAnimation variant="ring" synchronized size="sm" className="text-[var(--terminal-success)]" />
			)
		case 'pending':
			return (
				<SyncGridAnimation
					variant="snake"
					synchronized
					size="sm"
					speed={120}
					className="text-muted-foreground"
				/>
			)
		case 'interrupt_requested':
			return (
				<SyncGridAnimation variant="ring" synchronized size="sm" className="text-[var(--terminal-warning)]" />
			)
		case 'has_next_step':
			return (
				<ArrowRight className="w-4 h-4 text-[var(--terminal-success)] animate-pulse-success" strokeWidth={2} />
			)
		default:
			return null
	}
}

/**
 * Touch-friendly task row for the mobile tasks list.
 * Two-row layout:
 *   Top: title (left), optional status indicator (right)
 *   Bottom: label (left), session count (right)
 * Full-height chevron on the right.
 */
export const MobileTaskRow: FC<MobileTaskRowProps> = ({ taskName, label, sessionCount, status, onClick }) => {
	const hasBottomRow = label || sessionCount > 0
	const statusIndicator = renderTaskStatusIndicator(status)

	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				'w-full flex items-stretch gap-2 px-4 py-3 min-h-[48px]',
				'text-left border-b border-border last:border-b-0',
				'bg-background hover:bg-accent/5 active:bg-accent/10',
				'transition-colors cursor-pointer',
			)}
		>
			{/* Left content: two rows */}
			<div className="flex-1 min-w-0 flex flex-col justify-center gap-1">
				{/* Top row: title + optional status indicator (right-aligned) */}
				<div className="flex items-center gap-2">
					<span className="flex-1 min-w-0 text-sm font-medium truncate">{taskName}</span>
					{statusIndicator && (
						<div className="shrink-0 w-4 h-4 flex items-center justify-center">{statusIndicator}</div>
					)}
				</div>

				{/* Bottom row: label (left) + session count (right) */}
				{hasBottomRow && (
					<div className="flex items-center justify-between">
						<div>{label && <SessionLabelBadge label={label} />}</div>
						<span className="flex items-center gap-1 text-muted-foreground">
							<List className="h-3 w-3" />
							<span className="text-xs tabular-nums">{sessionCount}</span>
						</span>
					</div>
				)}
			</div>

			{/* Full-height chevron */}
			<div className="shrink-0 flex items-center">
				<ChevronRight className="h-5 w-5 text-muted-foreground" />
			</div>
		</button>
	)
}
