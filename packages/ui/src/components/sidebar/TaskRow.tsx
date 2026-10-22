import { ChevronRight } from 'lucide-react'
import { memo, type ReactNode } from 'react'

import { cn } from '../../lib/utils'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../collapsible'
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from '../context-menu'
import { SessionLabelBadge } from '../session-label-badge'
import { renderTaskStatusIndicator, UnreadBullet } from './status-indicators'
import type { SidebarTask } from './types'

const ROW_BASE = cn(
	'flex-1 min-w-0 grid items-center gap-2 px-2 py-1.5 text-left',
	'grid-cols-[minmax(0,1fr)_auto_14px_2.25rem]',
	'outline-hidden ring-sidebar-ring focus-visible:ring-2 focus-visible:ring-inset',
	'hover:bg-sidebar-accent transition-colors cursor-pointer',
)
const ROW_SELECTED = 'bg-sidebar-accent'
const TIME_CELL = 'text-[10px] text-muted-foreground tabular-nums text-right'

export interface TaskRowProps {
	task: SidebarTask
	isSelected: boolean
	isFocused: boolean
	showTaskPhaseLabels: boolean
	showTaskStatusIndicator: boolean
	open: boolean
	onOpenChange: (open: boolean) => void
	onSelect: () => void
	/**
	 * Opens a new session draft for this task. Required: the only live caller
	 * (`WiredTaskRow`) always wires it, so the "Create Session" context-menu item
	 * never renders inert.
	 */
	onCreateSession: () => void
	onRename: () => void
	onOpenPermissions: () => void
	onCopyDeepLink: () => void
	onArchive?: () => void
	children: ReactNode
	/** Opt-in hierarchy and row-local hover styling for the project sidebar. */
	projectTree?: boolean
	leadingIcon?: ReactNode
	wrapRow?: (row: ReactNode) => ReactNode
}

export const TaskRow = memo(function TaskRow({
	task,
	isSelected,
	isFocused,
	showTaskPhaseLabels,
	showTaskStatusIndicator,
	open,
	onOpenChange,
	onSelect,
	onCreateSession,
	onRename,
	onOpenPermissions,
	onCopyDeepLink,
	onArchive,
	children,
	projectTree = false,
	leadingIcon,
	wrapRow = (row) => row,
}: TaskRowProps) {
	const hasSessions = task.sessions.length > 0
	const statusIndicator = showTaskStatusIndicator ? renderTaskStatusIndicator(task.status) : null
	const showUnreadBullet = showTaskStatusIndicator && task.isUnread === true
	const taskPhaseLabel = showTaskPhaseLabels ? task.label : undefined

	return (
		<Collapsible
			asChild
			open={projectTree ? open && hasSessions : open}
			onOpenChange={onOpenChange}
			className="group/collapsible"
		>
			<li className="flex flex-col">
				<ContextMenu>
					<ContextMenuTrigger asChild>
						<div
							data-sidebar-task-header={task.id}
							className={cn(
								'w-full',
								projectTree && 'group/task-row border-r-2 border-r-transparent hover:bg-sidebar-accent',
								projectTree && isSelected && 'border-r-[var(--terminal-accent)] bg-sidebar-accent',
								projectTree && isFocused && 'bg-accent/10',
							)}
						>
							{wrapRow(
								<div className={cn('flex w-full items-stretch', projectTree && 'pl-6')}>
									{hasSessions ? (
										<CollapsibleTrigger asChild>
											<button
												type="button"
												aria-label={`Toggle sessions for ${task.name}`}
												className={cn(
													'flex shrink-0 items-center justify-center text-muted-foreground outline-hidden ring-sidebar-ring transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-inset',
													projectTree
														? 'w-4'
														: 'w-6',
												)}
											>
												<ChevronRight className="size-3 transition-transform duration-150 group-data-[state=open]/collapsible:rotate-90" />
											</button>
										</CollapsibleTrigger>
									) : (
										<span aria-hidden className={cn('shrink-0', projectTree ? 'w-4' : 'w-6')} />
									)}
									<button
										type="button"
										onClick={onSelect}
										aria-current={isSelected ? 'page' : undefined}
										data-active={isSelected ? 'true' : undefined}
										data-sidebar-task-id={task.id}
										className={cn(
											ROW_BASE,
											projectTree
												? 'py-1 pr-2 pl-1'
												: 'border-r-2 border-r-transparent',
											!projectTree &&
												isSelected &&
												`${ROW_SELECTED} border-r-[var(--terminal-accent)]`,
											!projectTree && isFocused && 'bg-accent/10',
										)}
									>
										<span
											className={cn(
												leadingIcon ? 'flex min-w-0 items-center gap-1.5' : 'truncate',
											projectTree ? 'text-sm font-normal text-sidebar-foreground' : 'text-xs',
											)}
										>
											{leadingIcon}
											{leadingIcon ? <span className="truncate">{task.name}</span> : task.name}
										</span>
										<span className="flex min-w-0 items-center justify-end gap-1.5">
											{taskPhaseLabel ? <SessionLabelBadge label={taskPhaseLabel} /> : null}
										</span>
										<span className="flex h-3.5 w-3.5 items-center justify-center">
											{statusIndicator ?? (showUnreadBullet ? <UnreadBullet /> : null)}
										</span>
										<span className={TIME_CELL}>{task.createdAt ?? ''}</span>
									</button>
								</div>,
							)}
						</div>
					</ContextMenuTrigger>
					<ContextMenuContent className="w-fit">
						<ContextMenuItem className="whitespace-nowrap" onSelect={onCreateSession}>
							Create Session
						</ContextMenuItem>
						<ContextMenuSeparator />
						<ContextMenuItem className="whitespace-nowrap" onSelect={onRename}>
							Rename task
						</ContextMenuItem>
						<ContextMenuItem className="whitespace-nowrap" onSelect={onOpenPermissions}>
							Manage permissions
						</ContextMenuItem>
						<ContextMenuSeparator />
						<ContextMenuItem className="whitespace-nowrap" onSelect={onCopyDeepLink}>
							Copy task deep link
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
				{hasSessions ? (
					<CollapsibleContent>
						<ul className="flex flex-col">{children}</ul>
					</CollapsibleContent>
				) : null}
			</li>
		</Collapsible>
	)
})
