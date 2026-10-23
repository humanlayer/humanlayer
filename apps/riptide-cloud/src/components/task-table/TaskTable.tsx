import { Avatar, AvatarFallback, AvatarImage } from '@humanlayer/ui/components/avatar'
import { SyncGridAnimation } from '@humanlayer/ui/components/sync-grid-animation'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@humanlayer/ui/components/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@humanlayer/ui/components/tooltip'
import { formatCompactRelativeTime, formatLocalAbsoluteTime } from '@humanlayer/ui/lib/time-format'
import { cn } from '@humanlayer/ui/lib/utils'
import {
	type ColumnDef,
	createColumnHelper,
	flexRender,
	getCoreRowModel,
	getSortedRowModel,
	type SortingState,
	useReactTable,
} from '@tanstack/react-table'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { type FC, useEffect, useMemo, useRef, useState } from 'react'

import type { OrgMember } from '@/hooks/useOrgMembers'

import { TasksEmptyState } from './TasksEmptyState'

export interface TableTask {
	id: string
	name: string | null
	created_at: string | number | bigint | null
	updated_at: string | number | bigint | null
	resource_owner_user_id: string | null
}

export interface TaskTableProps {
	tasks: TableTask[]
	isLoading?: boolean
	className?: string
	focusedTaskId?: string | null
	onFocusTask?: (task: TableTask) => void
	onBlurTask?: () => void
	onClickTask?: (task: TableTask) => void
	orgMembers?: Map<string, OrgMember>
}

const columnHelper = createColumnHelper<TableTask>()

function RelativeTimeCell({ value }: { value: string | number | bigint | null }) {
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

function timestampValue(value: string | number | bigint | null): number {
	if (!value) return 0
	if (typeof value === 'bigint') return Number(value)
	if (typeof value === 'number') return value
	return new Date(value).getTime()
}

function timestampSortingFn(
	rowA: { getValue: <T>(columnId: string) => T },
	rowB: { getValue: <T>(columnId: string) => T },
	columnId: string,
) {
	const a = rowA.getValue<string | number | bigint | null>(columnId)
	const b = rowB.getValue<string | number | bigint | null>(columnId)
	return timestampValue(a) - timestampValue(b)
}

export const TaskTable: FC<TaskTableProps> = ({
	tasks,
	isLoading,
	className,
	focusedTaskId,
	onFocusTask,
	onBlurTask,
	onClickTask,
	orgMembers,
}) => {
	const tableRef = useRef<HTMLTableElement>(null)
	const [sorting, setSorting] = useState<SortingState>([{ id: 'updated_at', desc: true }])

	// Scroll focused task into view
	useEffect(() => {
		if (focusedTaskId && tableRef.current) {
			const focusedRow = tableRef.current.querySelector(`[data-task-id="${focusedTaskId}"]`)
			if (focusedRow) {
				focusedRow.scrollIntoView({ behavior: 'auto', block: 'nearest' })
			}
		}
	}, [focusedTaskId])

	function getUserInitials(firstName?: string, lastName?: string, email?: string): string {
		if (firstName || lastName) {
			return `${firstName?.[0] || ''}${lastName?.[0] || ''}`.toUpperCase()
		}
		if (!email) return '?'
		const firstChar = email[0]
		return firstChar === undefined ? '?' : firstChar.toUpperCase()
	}

	const columns = useMemo<ColumnDef<TableTask>[]>(
		() => [
			columnHelper.accessor('name', {
				header: 'Name',
				cell: (info) => {
					const name = info.getValue() || 'Untitled Task'
					return (
						<div className="max-w-[40vw]">
							<Tooltip>
								<TooltipTrigger asChild>
									<span className="block truncate cursor-help font-medium text-terminal-accent">
										{name}
									</span>
								</TooltipTrigger>
								<TooltipContent className="max-w-[600px]">
									<span>{name}</span>
								</TooltipContent>
							</Tooltip>
						</div>
					)
				},
				enableSorting: true,
			}),
			columnHelper.accessor('created_at', {
				header: 'Created',
				cell: (info) => <RelativeTimeCell value={info.getValue()} />,
				enableSorting: true,
				sortingFn: timestampSortingFn,
			}),
			columnHelper.accessor('updated_at', {
				header: 'Updated',
				cell: (info) => <RelativeTimeCell value={info.getValue()} />,
				enableSorting: true,
				sortingFn: timestampSortingFn,
			}),
			columnHelper.accessor('resource_owner_user_id', {
				header: 'Owner',
				cell: (info) => {
					const userId = info.getValue()
					if (!userId || !orgMembers) return <span className="text-muted-foreground">-</span>
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
		],
		[orgMembers],
	)

	const table = useReactTable({
		data: tasks,
		columns,
		state: { sorting },
		onSortingChange: setSorting,
		getCoreRowModel: getCoreRowModel(),
		getSortedRowModel: getSortedRowModel(),
		getRowId: (row) => row.id,
	})

	if (isLoading) {
		return (
			<div className="flex flex-col items-center justify-center p-8 gap-3">
				<SyncGridAnimation variant="snake" size="md" speed={120} className="text-muted-foreground" />
				<p className="text-sm text-muted-foreground">Loading tasks...</p>
			</div>
		)
	}

	if (tasks.length === 0) {
		return <TasksEmptyState />
	}

	return (
		<div className={cn('overflow-auto', className)}>
			<Table ref={tableRef}>
				<TableHeader>
					{table.getHeaderGroups().map((headerGroup) => (
						<TableRow key={headerGroup.id}>
							{headerGroup.headers.map((header) => {
								const canSort = header.column.getCanSort()
								const sorted = header.column.getIsSorted()
								return (
									<TableHead
										key={header.id}
										className={canSort ? 'cursor-pointer select-none' : undefined}
										onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
									>
										<div className="flex items-center gap-1">
											{header.isPlaceholder
												? null
												: flexRender(header.column.columnDef.header, header.getContext())}
											{canSort && (
												<span className="text-muted-foreground">
													{sorted === 'asc' ? (
														<ArrowUp className="h-3 w-3" />
													) : sorted === 'desc' ? (
														<ArrowDown className="h-3 w-3" />
													) : (
														<ArrowUpDown className="h-3 w-3 opacity-50" />
													)}
												</span>
											)}
										</div>
									</TableHead>
								)
							})}
						</TableRow>
					))}
				</TableHeader>
				<TableBody>
					{table.getRowModel().rows.map((row) => {
						const isFocused = focusedTaskId === row.original.id
						return (
							<TableRow
								key={row.id}
								data-task-id={row.original.id}
								className={cn(
									'cursor-pointer transition-colors duration-200 border-l-2! border-b-0',
									isFocused
										? ['border-l-[var(--terminal-accent)]!', 'bg-accent/10']
										: ['border-l-transparent!', 'hover:bg-accent/10'],
								)}
								onClick={() => onClickTask?.(row.original)}
								onMouseEnter={() => onFocusTask?.(row.original)}
								onMouseLeave={() => onBlurTask?.()}
							>
								{row.getVisibleCells().map((cell) => (
									<TableCell key={cell.id} className="py-1.5">
										{flexRender(cell.column.columnDef.cell, cell.getContext())}
									</TableCell>
								))}
							</TableRow>
						)
					})}
				</TableBody>
			</Table>
		</div>
	)
}
