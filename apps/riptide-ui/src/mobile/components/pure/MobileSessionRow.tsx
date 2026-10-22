import { type SessionLabel, SessionLabelBadge } from '@humanlayer/ui/components/session-label-badge'
import { SyncGridAnimation } from '@humanlayer/ui/components/sync-grid-animation'
import { cn } from '@humanlayer/ui/lib/utils'
import { Archive, ChevronRight, MessageCircleQuestion, TriangleAlert } from 'lucide-react'
import type { FC } from 'react'

import type { SessionStatus } from '@/components/session-table/types'

export interface MobileSessionRowProps {
	sessionId: string
	title: string
	status?: SessionStatus
	label?: SessionLabel
	createdAt?: string
	archived?: boolean
	onClick: () => void
}

function renderStatusIndicator(status?: SessionStatus) {
	switch (status) {
		case 'running':
			return (
				<SyncGridAnimation variant="ring" synchronized size="sm" className="text-[var(--terminal-success)]" />
			)
		case 'interrupt_requested':
			return (
				<SyncGridAnimation variant="ring" synchronized size="sm" className="text-[var(--terminal-warning)]" />
			)
		case 'needs_approval':
			return <MessageCircleQuestion className="w-4 h-4 text-[var(--terminal-warning)]" strokeWidth={2} />
		case 'failed':
			return <TriangleAlert className="w-4 h-4 text-[var(--terminal-error)]" strokeWidth={2} />
		case 'lost':
			return <TriangleAlert className="w-4 h-4 text-[var(--terminal-warning)]" strokeWidth={2} />
		case 'launching':
		case 'ready_for_launch':
		case 'resuming':
			return (
				<SyncGridAnimation
					variant="snake"
					synchronized
					size="sm"
					speed={120}
					className="text-muted-foreground"
				/>
			)
		default:
			return null
	}
}

/**
 * Two-row layout:
 *   Row 1: title (left) + status indicator (right)
 *   Row 2: label (left, optional) + time info (right)
 */
export const MobileSessionRow: FC<MobileSessionRowProps> = ({
	title,
	status,
	label,
	createdAt,
	archived = false,
	onClick,
}) => {
	const statusIndicator = renderStatusIndicator(status)
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				'w-full flex items-stretch gap-2 px-4 py-3 min-h-[48px]',
				'text-left border-b border-border last:border-b-0',
				'bg-background hover:bg-accent/5 active:bg-accent/10',
				'transition-colors cursor-pointer',
				archived && 'opacity-60',
			)}
		>
			<div className="flex-1 min-w-0 flex flex-col justify-center gap-1">
				{/* Row 1: title + status indicator */}
				<div className="flex items-center gap-2">
					<span className="flex-1 min-w-0 text-sm font-medium truncate">{title}</span>
					{statusIndicator && (
						<div className="shrink-0 w-4 h-4 flex items-center justify-center">{statusIndicator}</div>
					)}
				</div>

				{/* Row 2: label + archived marker (left) + time (right) */}
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-2">
						{label && <SessionLabelBadge label={label} />}
						{archived && (
							<span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
								<Archive className="h-3 w-3" />
								Archived
							</span>
						)}
					</div>
					{createdAt && <span className="text-xs text-muted-foreground shrink-0">{createdAt}</span>}
				</div>
			</div>

			<div className="shrink-0 flex items-center">
				<ChevronRight className="h-5 w-5 text-muted-foreground" />
			</div>
		</button>
	)
}
