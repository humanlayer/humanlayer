import { ArrowRight, Circle, Clock, FolderKanban, FolderTree, List, MessageCircleQuestion, TriangleAlert } from 'lucide-react'

import { SyncGridAnimation } from '../sync-grid-animation'
import { cn } from '../../lib/utils'
import { UnreadBullet } from './status-indicators'

export type SidebarSectionIcon =
	| 'drafts'
	| 'tasks'
	| 'projects'
	| 'standalone'
	| 'unread'
	| 'running'
	| 'interrupt_requested'
	| 'needs_approval'
	| 'failed'
	| 'lost'
	| 'has_next_step'
	| 'pending'
	| 'idle'
	| 'recent'

export interface SidebarSectionHeaderProps {
	icon: SidebarSectionIcon
	label: string
	count?: number
	onClick?: () => void
}

function SectionIcon({ icon }: { icon: SidebarSectionIcon }) {
	switch (icon) {
		case 'drafts':
		case 'standalone':
			return <List className="h-3 w-3 text-muted-foreground" strokeWidth={1.5} />
		case 'tasks':
			return <FolderKanban className="h-3 w-3 text-muted-foreground" strokeWidth={1.5} />
		case 'projects':
			return <FolderTree aria-hidden className="h-3 w-3 text-muted-foreground" strokeWidth={1.5} />
		case 'unread':
			return <UnreadBullet />
		case 'running':
			return <SyncGridAnimation variant="ring" synchronized size="sm" className="text-[var(--terminal-success)]" />
		case 'interrupt_requested':
			return <SyncGridAnimation variant="ring" synchronized size="sm" className="text-[var(--terminal-warning)]" />
		case 'needs_approval':
			return (
				<MessageCircleQuestion
					className="h-3 w-3 animate-pulse-warning text-[var(--terminal-warning)]"
					strokeWidth={2}
				/>
			)
		case 'failed':
			return (
				<TriangleAlert className="h-3 w-3 animate-pulse-error text-[var(--terminal-error)]" strokeWidth={2} />
			)
		case 'lost':
			return <TriangleAlert className="h-3 w-3 text-[var(--terminal-warning)]" strokeWidth={2} />
		case 'has_next_step':
			return (
				<ArrowRight
					className="h-3 w-3 animate-pulse-success text-[var(--terminal-success)]"
					strokeWidth={2}
				/>
			)
		case 'recent':
			return <Clock className="h-3 w-3 text-muted-foreground" strokeWidth={1.5} />
		case 'pending':
		case 'idle':
			return <Circle className="h-3 w-3 text-muted-foreground" strokeWidth={1.5} />
	}
}

function sectionLabelColor(icon: SidebarSectionIcon) {
	switch (icon) {
		case 'unread':
			return 'text-[var(--terminal-accent)]'
		case 'running':
			return 'text-[var(--terminal-success)]'
		case 'needs_approval':
		case 'lost':
		case 'interrupt_requested':
			return 'text-[var(--terminal-warning)]'
		case 'failed':
			return 'text-[var(--terminal-error)]'
		default:
			return 'text-muted-foreground'
	}
}

export function SidebarSectionHeader({ icon, label, count, onClick }: SidebarSectionHeaderProps) {
	const content = (
		<>
			<span className="flex h-3 w-3 shrink-0 items-center justify-center">
				<SectionIcon icon={icon} />
			</span>
			<span className={cn('flex-1 text-left text-[10px] font-medium uppercase tracking-[0.15em]', sectionLabelColor(icon))}>
				{label}
			</span>
			{count !== undefined ? (
				<span className="bg-sidebar-accent px-1.5 text-[10px] tabular-nums text-muted-foreground">{count}</span>
			) : null}
		</>
	)

	if (onClick) {
		return (
			<button
				type="button"
				onClick={onClick}
				className="flex w-full cursor-pointer items-center gap-2 px-3 pb-1 pt-2.5 transition-colors hover:bg-sidebar-accent"
			>
				{content}
			</button>
		)
	}

	return <div className="flex items-center gap-2 px-3 pb-1 pt-2.5">{content}</div>
}
