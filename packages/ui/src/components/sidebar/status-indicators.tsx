import { ArrowRight, Gauge, MessageCircleQuestion, TriangleAlert } from 'lucide-react'

import { SyncGridAnimation } from '../sync-grid-animation'
import type { TaskStatus } from './types'

export function UnreadBullet() {
	return <span aria-label="Unread" className="size-1.5 rounded-none bg-primary" />
}

export function renderTaskStatusIndicator(status?: TaskStatus) {
	switch (status) {
		case 'needs_approval':
			return (
				<MessageCircleQuestion
					className="h-3.5 w-3.5 animate-pulse-warning text-[var(--terminal-warning)]"
					strokeWidth={2}
				/>
			)
		case 'failed':
			return (
				<TriangleAlert
					className="h-3.5 w-3.5 animate-pulse-error text-[var(--terminal-error)]"
					strokeWidth={2}
				/>
			)
		case 'lost':
			return <TriangleAlert className="h-3.5 w-3.5 text-[var(--terminal-warning)]" strokeWidth={2} />
		case 'running':
			return <SyncGridAnimation variant="ring" synchronized size="sm" className="text-[var(--terminal-success)]" />
		case 'pending':
			return <SyncGridAnimation variant="snake" synchronized size="sm" speed={120} className="text-muted-foreground" />
		case 'interrupt_requested':
			return <SyncGridAnimation variant="ring" synchronized size="sm" className="text-[var(--terminal-warning)]" />
		case 'has_next_step':
			return (
				<ArrowRight
					className="h-3.5 w-3.5 animate-pulse-success text-[var(--terminal-success)]"
					strokeWidth={2}
				/>
			)
		default:
			return null
	}
}

export function renderSessionStatusIndicator(status?: string | null) {
	switch (status) {
		case 'running':
			return <SyncGridAnimation variant="ring" synchronized size="sm" className="text-[var(--terminal-success)]" />
		case 'interrupt_requested':
			return <SyncGridAnimation variant="ring" synchronized size="sm" className="text-[var(--terminal-warning)]" />
		case 'needs_approval':
			return (
				<MessageCircleQuestion
					className="h-3.5 w-3.5 animate-pulse-warning text-[var(--terminal-warning)]"
					strokeWidth={2}
				/>
			)
		case 'failed':
			return <TriangleAlert className="h-3.5 w-3.5 text-[var(--terminal-error)]" strokeWidth={2} />
		case 'lost':
			return <TriangleAlert className="h-3.5 w-3.5 text-[var(--terminal-warning)]" strokeWidth={2} />
		case 'waiting_for_usage_limit':
			return <Gauge className="h-3.5 w-3.5 text-[var(--terminal-warning)]" strokeWidth={2} />
		case 'launching':
		case 'ready_for_launch':
		case 'resuming':
			return <SyncGridAnimation variant="snake" synchronized size="sm" speed={120} className="text-muted-foreground" />
		default:
			return null
	}
}
