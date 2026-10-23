import { Cloud } from 'lucide-react'
import { memo } from 'react'

import { cn } from '../../lib/utils'
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from '../context-menu'
import { renderSessionStatusIndicator, UnreadBullet } from './status-indicators'
import type { SidebarSession } from './types'

const TIME_CELL = 'text-[10px] text-muted-foreground tabular-nums text-right'

export interface SessionRowProps {
	session: SidebarSession
	isSelected: boolean
	isFocused: boolean
	nested: boolean
	projectTree?: boolean
	// Show a cloud icon at the right edge of the name cell (session runs on a non-colocated host)
	showHostIndicator?: boolean
	onSelect: () => void
	onRename: () => void
	onCopyDeepLink: () => void
	onArchive?: () => void
}

export const SessionRow = memo(function SessionRow({
	session,
	isSelected,
	isFocused,
	nested,
	projectTree = false,
	showHostIndicator,
	onSelect,
	onRename,
	onCopyDeepLink,
	onArchive,
}: SessionRowProps) {
	const indicator = renderSessionStatusIndicator(session.status)

	return (
		<li className="flex">
			<ContextMenu>
				<ContextMenuTrigger asChild>
					<button
						type="button"
						onClick={onSelect}
						aria-current={isSelected ? 'page' : undefined}
						data-active={isSelected ? 'true' : undefined}
						data-sidebar-session-id={session.id}
						className={cn(
							'grid min-w-0 flex-1 cursor-pointer items-center gap-2 py-1.5 pr-2 text-left',
							projectTree ? (nested ? 'pl-16 py-1' : 'pl-10 py-1') : nested ? 'pl-14' : 'pl-10',
							'grid-cols-[minmax(0,1fr)_14px_2.25rem]',
							'border-r-2 border-r-transparent',
							'outline-hidden ring-sidebar-ring focus-visible:ring-2 focus-visible:ring-inset',
							'transition-colors hover:bg-sidebar-accent',
							isSelected && 'border-r-[var(--terminal-accent)] bg-sidebar-accent',
							isFocused && 'bg-accent/10',
						)}
					>
						<span className="flex min-w-0 items-center gap-1">
							<span
								className={cn(
									'truncate',
									projectTree ? 'text-sm font-normal text-sidebar-foreground' : 'text-xs',
								)}
							>
								{session.name}
							</span>
							{showHostIndicator ? (
								<Cloud
									aria-label="Remote host"
									className="ml-auto h-3 w-3 shrink-0 text-muted-foreground"
								/>
							) : null}
						</span>
						<span className="flex h-3.5 w-3.5 items-center justify-center">
							{indicator ?? (session.isUnread ? <UnreadBullet /> : null)}
						</span>
						<span className={TIME_CELL}>{session.createdAt ?? ''}</span>
					</button>
				</ContextMenuTrigger>
				<ContextMenuContent className="w-fit">
					<ContextMenuItem className="whitespace-nowrap" onSelect={onRename}>
						Rename session
					</ContextMenuItem>
					<ContextMenuSeparator />
					<ContextMenuItem className="whitespace-nowrap" onSelect={onCopyDeepLink}>
						Copy session deep link
					</ContextMenuItem>
					{onArchive ? (
						<>
							<ContextMenuSeparator />
							<ContextMenuItem className="whitespace-nowrap" onSelect={onArchive}>
								Archive
							</ContextMenuItem>
						</>
					) : null}
				</ContextMenuContent>
			</ContextMenu>
		</li>
	)
})
