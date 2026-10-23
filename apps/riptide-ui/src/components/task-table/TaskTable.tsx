import { Avatar, AvatarFallback, AvatarImage } from '@humanlayer/ui/components/avatar'
import { Button } from '@humanlayer/ui/components/button'
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from '@humanlayer/ui/components/context-menu'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@humanlayer/ui/components/dropdown-menu'
import { UnreadBullet } from '@humanlayer/ui/components/sidebar/status-indicators'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@humanlayer/ui/components/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@humanlayer/ui/components/tooltip'
import { formatCompactRelativeTime, formatLocalAbsoluteTime } from '@humanlayer/ui/lib/time-format'
import { Link } from '@tanstack/react-router'
import {
	type ColumnDef,
	createColumnHelper,
	flexRender,
	getCoreRowModel,
	type Row,
	useReactTable,
} from '@tanstack/react-table'
import { Archive, FolderArchive, Link as LinkIcon, MoreHorizontal, Settings } from 'lucide-react'
import { type FC, Fragment, memo, useCallback, useMemo, useRef } from 'react'

import { useFocusStore } from '@/hooks/stores/focusStore'
import { useCommandPaletteAction } from '@/hooks/useCommandPaletteAction'
import { useKeybindingDisplays } from '@/hooks/useKeybindingDisplays'
import { useMountEffect } from '@/hooks/useMountEffect'
import type { OrgMember } from '@/hooks/useOrgMembers'
import { hotkeysCatalog } from '@/hotkeysCatalog'
import { copyTaskDeepLink } from '@/utils/sharing-links'

import { cn } from '../../lib/utils'
import { TaskLabelCell } from './TaskLabelCell'
import { TasksEmptyState } from './TasksEmptyState'
import { TaskStatusIndicator } from './TaskStatusIndicator'

export interface TableTask {
	id: string
	name: string
	lastActivityAt: string
	sessionCount?: number
	created_at?: number | string
	/** Whether this task is archived */
	archived?: boolean
	/** Whether this task is a draft (not yet launched) */
	is_draft?: boolean
	/** Whether this task is shared with the org */
	isSharedWithOrg?: boolean
	/** Whether the current user owns this task */
	isOwner?: boolean
	/** Owner user ID for displaying owner info */
	resource_owner_user_id?: string | null
	/** True if any owned session within this task is currently unread */
	isUnread?: boolean
}

function RelativeTimeCell({ value }: { value: number | string | null | undefined }) {
	if (!value) return '-'
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<span className="cursor-help text-muted-foreground">{formatCompactRelativeTime(value)}</span>
			</TooltipTrigger>
			<TooltipContent>{formatLocalAbsoluteTime(value)}</TooltipContent>
		</Tooltip>
	)
}

interface TaskTableRowProps {
	row: Row<TableTask>
	isFocused: boolean
	hideLiveIndicators: boolean
	hideActionMenu: boolean
	onRowClick: (task: TableTask) => void
	onRowMouseEnter: (task: TableTask) => void
	onRowMouseLeave?: () => void
	renderActionMenu: (task: TableTask) => React.ReactNode
	/**
	 * Called when the "Archive Task" palette action / row menu runs (same handler as the `e` hotkey).
	 * Required, but explicitly `null` for views with no archive handler (shared/archived tabs) — the
	 * "no handler" state is a real runtime state, so callers must opt in rather than silently omit it.
	 */
	onArchiveTask: ((task: TableTask) => void) | null
	onCreateSession: ((task: TableTask) => void) | null
}

const TaskTableRow = memo(
	function TaskTableRow({
		row,
		isFocused,
		hideLiveIndicators,
		hideActionMenu,
		onRowClick,
		onRowMouseEnter,
		onRowMouseLeave,
		renderActionMenu,
		onArchiveTask,
		onCreateSession,
	}: TaskTableRowProps) {
		// Stable `onSelect` keyed on the row *id* (not the `row.original` object) so an
		// unrelated re-render of an unfocused row can't recreate this handler and churn
		// the shared `archive-task` registry entry (which would transiently unregister
		// the focused row's action). See the shared-id safety note in the structure outline.
		const handleArchiveSelect = useCallback(
			() => onArchiveTask?.(row.original),
			// Intentionally keyed on the row id rather than `row.original`.
			[onArchiveTask, row.original.id],
		)

		const keybindingDisplays = useKeybindingDisplays()

		// Register the "Archive Task" palette action only while this row is the focused,
		// archivable one — mirroring the 3-dot menu's visibility gating. Reuses the same
		// handler the `e` hotkey calls, so palette behavior can't drift from the hotkey.
		useCommandPaletteAction({
			id: 'archive-task',
			label: 'Archive Task',
			icon: FolderArchive,
			shortcut: keybindingDisplays.archive,
			enabled: isFocused && !hideActionMenu && row.original.isOwner !== false && Boolean(onArchiveTask),
			onSelect: handleArchiveSelect,
		})

		// Stable handler keyed on the row id, same as `handleArchiveSelect` above.
		const handleCopyUrlSelect = useCallback(
			() => void copyTaskDeepLink(row.original.id),
			// Intentionally keyed on the row id rather than `row.original`.
			[row.original.id],
		)

		// "Copy Task URL" for the focused row. Drafts are excluded — they have no
		// `/tasks/$taskId` route until launched.
		useCommandPaletteAction({
			id: 'copy-task-url',
			label: 'Copy Task URL',
			icon: LinkIcon,
			shortcut: hotkeysCatalog.global.shortcuts.copyPrimaryUrl.display,
			enabled: isFocused && !row.original.is_draft,
			onSelect: handleCopyUrlSelect,
		})

		const tableRow = (
			<TableRow
				data-task-id={row.id}
				className={cn(
					'cursor-pointer transition-colors duration-200 border-l-2! border-b-0',
					isFocused
						? ['border-l-[var(--terminal-accent)]!', 'bg-accent/10']
						: ['border-l-transparent!', 'hover:bg-transparent!'],
				)}
				onClick={() => onRowClick(row.original)}
				onMouseEnter={() => onRowMouseEnter(row.original)}
				onMouseLeave={onRowMouseLeave}
			>
				<TableCell className="relative w-4 pr-4 pl-12 align-middle">
					{row.original.isUnread && (
						<span className="absolute left-6 top-1/2 -translate-y-1/2 inline-flex items-center justify-center">
							<UnreadBullet />
						</span>
					)}
					<div className="flex items-center justify-center">
						{!hideLiveIndicators && <TaskStatusIndicator taskId={row.id} />}
					</div>
				</TableCell>
				{row.getVisibleCells().map((cell, index) => (
					<Fragment key={cell.id}>
						<TableCell>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
						{index === 0 && (
							<TableCell>
								{row.original.is_draft ? (
									<span className="text-xs text-muted-foreground">Draft</span>
								) : (
									!hideLiveIndicators && <TaskLabelCell taskId={row.id} />
								)}
							</TableCell>
						)}
					</Fragment>
				))}
				{!hideActionMenu && <TableCell className="w-[40px] pr-4">{renderActionMenu(row.original)}</TableCell>}
			</TableRow>
		)

		if (!onCreateSession || row.original.is_draft) return tableRow

		return (
			<ContextMenu>
				<ContextMenuTrigger asChild>{tableRow}</ContextMenuTrigger>
				<ContextMenuContent className="w-fit">
					<ContextMenuItem className="whitespace-nowrap" onSelect={() => onCreateSession(row.original)}>
						Create Session
					</ContextMenuItem>
				</ContextMenuContent>
			</ContextMenu>
		)
	},
	(prev, next) =>
		prev.row.id === next.row.id &&
		prev.isFocused === next.isFocused &&
		prev.row.original === next.row.original &&
		prev.hideLiveIndicators === next.hideLiveIndicators &&
		prev.hideActionMenu === next.hideActionMenu &&
		prev.onArchiveTask === next.onArchiveTask &&
		prev.onCreateSession === next.onCreateSession,
)

export type TaskFocusCursor = 'task-draft' | 'archived-task'

/**
 * Exactly one focus mode per table: store-backed rows subscribe to the focus
 * store per cursor; controlled focus is for list views and demos that own the
 * focused id themselves (`null` = controlled with nothing focused).
 */
export type TaskTableFocus =
	| { mode: 'store'; cursor: TaskFocusCursor }
	| { mode: 'controlled'; focusedTaskId: string | null }

const WiredTaskTableRow = memo(function WiredTaskTableRow(
	props: Omit<TaskTableRowProps, 'isFocused'> & { focusCursor: TaskFocusCursor },
) {
	const { focusCursor, ...rowProps } = props
	const isFocused = useFocusStore((state) =>
		focusCursor === 'archived-task'
			? state.focusedArchivedTaskId === props.row.id
			: state.focusedTaskDraftId === props.row.id,
	)

	return <TaskTableRow {...rowProps} isFocused={isFocused} />
})

export interface TaskTableProps {
	tasks: TableTask[]
	/** Optional row groups. Omit to preserve the flat table layout. */
	groups?: ReadonlyArray<{
		id: string
		title: string
		taskIds: readonly string[]
	}>
	focus: TaskTableFocus
	onRowClick: (task: TableTask) => void
	onRowMouseEnter: (task: TableTask) => void
	onRowMouseLeave?: () => void
	className?: string
	/** Hide live status indicators (for Storybook/testing without ElectricProvider) */
	hideLiveIndicators?: boolean
	/** Hide action menu (for archived tasks view) */
	hideActionMenu?: boolean
	/**
	 * Called when user clicks Archive in row menu / runs the "Archive Task" palette action.
	 * Required, but explicitly `null` for views with no archive handler (shared/archived tabs) so the
	 * "no handler" state is expressed intentionally rather than by omitting the prop (`undefined`).
	 */
	onArchiveTask: ((task: TableTask) => void) | null
	/** Opens the session draft launcher with the task and its working directory pre-filled. */
	onCreateSession: ((task: TableTask) => void) | null
	/**
	 * Called when user clicks Manage Permissions in row menu.
	 * Required, but explicitly `null` for views with no permissions handler (draft/archived tabs) so the
	 * "no handler" state is expressed intentionally rather than by omitting the prop (`undefined`).
	 * When `null`, the Manage Permissions row action is not rendered.
	 */
	onManagePermissions: ((task: TableTask) => void) | null
	/** Organization members map for displaying owner names/avatars */
	orgMembers?: Map<string, OrgMember>
}

const columnHelper = createColumnHelper<TableTask>()

function getUserInitials(firstName?: string, lastName?: string, email?: string): string {
	if (firstName || lastName) {
		return `${firstName?.[0] || ''}${lastName?.[0] || ''}`.toUpperCase()
	}
	return email ? (email[0]?.toUpperCase() ?? '?') : '?'
}

export const TaskTable: FC<TaskTableProps> = ({
	tasks,
	groups,
	focus,
	onRowClick,
	onRowMouseEnter,
	onRowMouseLeave,
	className,
	hideLiveIndicators = false,
	hideActionMenu = false,
	onArchiveTask,
	onCreateSession,
	onManagePermissions,
	orgMembers,
}) => {
	const tableRootRef = useRef<HTMLDivElement>(null)
	const columns = useMemo<ColumnDef<TableTask, unknown>[]>(() => {
		const columns: ColumnDef<TableTask, unknown>[] = [
			columnHelper.accessor('name', {
				header: 'Name',
				cell: (info) => {
					const name = info.getValue() || 'Untitled Task'
					const taskId = info.row.original.id
					const isDraft = info.row.original.is_draft
					return (
						<div className="max-w-[40vw]">
							<Link
								to={isDraft ? '/tasks/new' : '/tasks/$taskId'}
								params={isDraft ? {} : { taskId }}
								search={isDraft ? { draftId: taskId } : {}}
								preload="viewport"
								className="block truncate font-medium no-underline"
								onClick={(e) => e.stopPropagation()}
							>
								<Tooltip>
									<TooltipTrigger asChild>
										<span className="cursor-help">{name}</span>
									</TooltipTrigger>
									<TooltipContent className="max-w-[600px]">
										<span>{name}</span>
									</TooltipContent>
								</Tooltip>
							</Link>
						</div>
					)
				},
			}),
		]
		if (orgMembers) {
			columns.push(
				columnHelper.accessor('resource_owner_user_id', {
					header: 'Owner',
					cell: (info) => {
						const userId = info.getValue()
						if (!userId) return <span className="text-muted-foreground">-</span>
						const member = orgMembers.get(userId)
						if (!member)
							return <span className="text-muted-foreground text-xs truncate">{userId.slice(0, 8)}</span>
						const fullName = [member.firstName, member.lastName].filter(Boolean).join(' ') || member.email
						const initials = getUserInitials(member.firstName, member.lastName, member.email)
						return (
							<div className="flex items-center gap-2 min-w-0">
								<Avatar className="h-5 w-5 shrink-0">
									<AvatarImage src={member.profilePictureUrl ?? ''} alt={fullName} />
									<AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
								</Avatar>
								<Tooltip>
									<TooltipTrigger asChild>
										<span className="text-sm truncate cursor-help">{fullName}</span>
									</TooltipTrigger>
									<TooltipContent>{fullName}</TooltipContent>
								</Tooltip>
							</div>
						)
					},
					enableSorting: false,
				}),
			)
		}
		columns.push(
			columnHelper.accessor('sessionCount', {
				header: 'Sessions',
				cell: (info) => {
					const count = info.getValue()
					return <span className="text-muted-foreground">{count ?? 0}</span>
				},
			}),
			columnHelper.accessor('created_at', {
				header: 'Created',
				cell: (info) => <RelativeTimeCell value={info.getValue()} />,
			}),
			columnHelper.accessor('lastActivityAt', {
				header: 'Updated',
				cell: (info) => <RelativeTimeCell value={info.getValue()} />,
			}),
		)
		return columns
	}, [orgMembers])

	// Render action menu for a task
	const renderActionMenu = useCallback(
		(task: TableTask) => {
			const showShareOption = onManagePermissions !== null && task.isOwner !== false // Show if owner or ownership unknown
			const showArchiveOption = task.isOwner !== false
			const isShared = task.isSharedWithOrg === true

			const handleCopyDeepLink = async (e: React.MouseEvent) => {
				e.stopPropagation()
				await copyTaskDeepLink(task.id)
			}

			return (
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							variant="ghost"
							size="icon"
							className="h-6 w-6 cursor-pointer"
							aria-label="Task actions"
							onClick={(e) => e.stopPropagation()}
						>
							<MoreHorizontal className="h-3.5 w-3.5 text-accent hover:text-accent/80 transition-colors" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						{isShared && (
							<DropdownMenuItem className="group cursor-pointer" onClick={handleCopyDeepLink}>
								<LinkIcon className="h-4 w-4 mr-2 group-hover:text-background group-focus:text-accent-foreground" />
								<span className="group-hover:text-background">Copy task deep link</span>
							</DropdownMenuItem>
						)}
						{isShared && (showArchiveOption || showShareOption) && <DropdownMenuSeparator />}
						{showArchiveOption && (
							<DropdownMenuItem
								className="group cursor-pointer"
								onClick={(e) => {
									e.stopPropagation()
									onArchiveTask?.(task)
								}}
							>
								<Archive className="h-4 w-4 mr-2 group-focus:text-accent-foreground" />
								Archive
							</DropdownMenuItem>
						)}
						{showShareOption && onManagePermissions && (
							<DropdownMenuItem
								className="group cursor-pointer"
								onClick={(e) => {
									e.stopPropagation()
									onManagePermissions(task)
								}}
							>
								<Settings className="h-4 w-4 mr-2 group-focus:text-accent-foreground" />
								Manage Permissions
							</DropdownMenuItem>
						)}
					</DropdownMenuContent>
				</DropdownMenu>
			)
		},
		[onArchiveTask, onManagePermissions],
	)

	const table = useReactTable({
		data: tasks,
		columns,
		getCoreRowModel: getCoreRowModel(),
		getRowId: (row) => row.id,
		sortDescFirst: true,
		initialState: {
			sorting: [{ id: 'lastActivityAt', desc: true }],
		},
	})

	// Store-backed tables observe focus imperatively so cursor movement never
	// renders the table owner. Mount-scoped: the focus mode is configuration
	// fixed for the life of a mounted table.
	useMountEffect(() => {
		if (focus.mode !== 'store') return
		const cursor = focus.cursor
		return useFocusStore.subscribe((state, previousState) => {
			const nextId = cursor === 'archived-task' ? state.focusedArchivedTaskId : state.focusedTaskDraftId
			const previousId =
				cursor === 'archived-task' ? previousState.focusedArchivedTaskId : previousState.focusedTaskDraftId
			if (state.focusSource !== 'keyboard' || !nextId || nextId === previousId || !tableRootRef.current) return
			const focusedRow = Array.from(tableRootRef.current.querySelectorAll<HTMLElement>('[data-task-id]')).find(
				(row) => row.dataset.taskId === nextId,
			)
			focusedRow?.scrollIntoView({ behavior: 'instant', block: 'nearest' })
		})
	})
	// Keyed on the row array, not the table: `table` is a stable reference across
	// renders, so memoizing on it would freeze this map at the first render's rows.
	const rows = table.getRowModel().rows
	const rowsById = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows])
	const columnCount = table.getVisibleLeafColumns().length + 2 + (hideActionMenu ? 0 : 1)

	if (tasks.length === 0 && !groups) {
		return <TasksEmptyState />
	}

	const renderRow = (row: Row<TableTask>) => {
		const rowProps = {
			row,
			hideLiveIndicators,
			hideActionMenu,
			onRowClick,
			onRowMouseEnter,
			onRowMouseLeave,
			renderActionMenu,
			onArchiveTask,
			onCreateSession,
		}

		return focus.mode === 'store' ? (
			<WiredTaskTableRow key={row.id} {...rowProps} focusCursor={focus.cursor} />
		) : (
			<TaskTableRow key={row.id} {...rowProps} isFocused={focus.focusedTaskId === row.id} />
		)
	}

	return (
		<div ref={tableRootRef} className={cn('overflow-auto', className)}>
			<Table>
				<TableHeader>
					{table.getHeaderGroups().map((headerGroup) => (
						<TableRow key={headerGroup.id}>
							<TableHead className="w-fit" />
							{headerGroup.headers.map((header, index) => (
								<Fragment key={header.id}>
									<TableHead>
										{header.isPlaceholder
											? null
											: flexRender(header.column.columnDef.header, header.getContext())}
									</TableHead>
									{index === 0 && <TableHead>Step</TableHead>}
								</Fragment>
							))}
							{!hideActionMenu && <TableHead className="w-[40px]" />}
						</TableRow>
					))}
				</TableHeader>
				<TableBody>
					{groups
						? groups.map((group) => {
								const rows = group.taskIds.flatMap((taskId) => {
									const row = rowsById.get(taskId)
									return row ? [row] : []
								})

								return (
									<Fragment key={group.id}>
										<TableRow className="hover:bg-muted/40">
											<TableCell colSpan={columnCount} className="bg-muted/30 py-2 font-semibold">
												{group.title}
												<span className="ml-2 text-xs font-normal text-muted-foreground">
													{rows.length}
												</span>
											</TableCell>
										</TableRow>
										{rows.length > 0 ? (
											rows.map(renderRow)
										) : (
											<TableRow className="hover:bg-transparent">
												<TableCell
													colSpan={columnCount}
													className="py-5 text-center text-sm text-muted-foreground"
												>
													No tasks
												</TableCell>
											</TableRow>
										)}
									</Fragment>
								)
							})
						: rows.map(renderRow)}
				</TableBody>
			</Table>
		</div>
	)
}
