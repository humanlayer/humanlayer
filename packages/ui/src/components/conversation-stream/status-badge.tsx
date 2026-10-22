import { Badge } from '@humanlayer/ui/components/badge'
import { SyncGridAnimation } from '@humanlayer/ui/components/sync-grid-animation'
import type { FC } from 'react'
import type { ApprovalStatus } from './types'

export interface StatusBadgeProps {
	status?: ApprovalStatus | 'groupRunning' | 'interrupted'
}

export const StatusBadge: FC<StatusBadgeProps> = ({ status }) => {
	// Only show badge for pending and special states
	if (!status) return null

	switch (status) {
		case 'pending':
			return (
				<Badge
					variant="outline"
					className="text-[var(--terminal-warning)] border-[var(--terminal-warning)]/50 text-sm uppercase"
				>
					NEEDS_APPROVAL
				</Badge>
			)
		case 'groupRunning':
			return (
				<SyncGridAnimation
					variant="ring"
					synchronized
					size="sm"
					className="shrink-0 text-[var(--terminal-success)]"
				/>
			)
		case 'interrupted':
			return (
				<Badge
					variant="outline"
					className="text-[var(--terminal-error)] border-[var(--terminal-error)]/50 text-sm uppercase"
				>
					INTERRUPTED
				</Badge>
			)
		// Hide badge for approved/denied/resolved - color is on tool name
		case 'approved':
		case 'denied':
		case 'resolved':
		default:
			return null
	}
}
