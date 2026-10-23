import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@humanlayer/ui/components/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@humanlayer/ui/components/tooltip'
import { cn } from '@humanlayer/ui/lib/utils'
import { useNavigate } from '@tanstack/react-router'
import {
	type ColumnDef,
	createColumnHelper,
	flexRender,
	getCoreRowModel,
	getSortedRowModel,
	type SortingState,
	useReactTable,
} from '@tanstack/react-table'
import { ArrowDown, ArrowUp, ArrowUpDown, MessageSquare } from 'lucide-react'
import { type FC, useEffect, useMemo, useRef, useState } from 'react'

import { type DocumentType, DocumentTypeBadge, VALID_DOCUMENT_TYPES } from '@/utils/document-types'
import { formatTimestamp } from '@/utils/formatting'

import { ArtifactsEmptyState } from './ArtifactsEmptyState'

export interface TableArtifact {
	id: string
	file_name: string
	task_id: string | null
	task_slug: string | null
	task_name?: string | null
	last_updated_at: string | number | bigint | null
	frontmatter: Record<string, unknown> | string | null | undefined
	comment_count?: number
	is_deleted?: boolean
}

export interface ArtifactTableProps {
	artifacts: TableArtifact[]
	isLoading?: boolean
	className?: string
	focusedArtifactId?: string | null
	onFocusArtifact?: (artifact: TableArtifact) => void
	onBlurArtifact?: () => void
}

const columnHelper = createColumnHelper<TableArtifact>()

function timestampValue(value: string | number | bigint | null): number {
	if (!value) return 0
	if (typeof value === 'bigint') return Number(value)
	if (typeof value === 'number') return value
	return new Date(value).getTime()
}

export const ArtifactTable: FC<ArtifactTableProps> = ({
	artifacts,
	isLoading,
	className,
	focusedArtifactId,
	onFocusArtifact,
	onBlurArtifact,
}) => {
	const navigate = useNavigate()
	const tableRef = useRef<HTMLTableElement>(null)
	const [sorting, setSorting] = useState<SortingState>([{ id: 'last_updated_at', desc: true }])

	// Scroll focused artifact into view
	useEffect(() => {
		if (focusedArtifactId && tableRef.current) {
			const focusedRow = tableRef.current.querySelector(`[data-artifact-id="${focusedArtifactId}"]`)
			if (focusedRow) {
				focusedRow.scrollIntoView({ behavior: 'auto', block: 'nearest' })
			}
		}
	}, [focusedArtifactId])

	const columns = useMemo<ColumnDef<TableArtifact>[]>(
		() => [
			columnHelper.accessor('task_slug', {
				header: 'Task',
				cell: (info) => {
					const taskName = info.row.original.task_name
					const displayName = taskName || info.getValue() || '-'
					return (
						<div className="max-w-[30vw]">
							<Tooltip>
								<TooltipTrigger asChild>
									<span className="block truncate cursor-help font-medium text-terminal-accent">
										{displayName}
									</span>
								</TooltipTrigger>
								<TooltipContent className="max-w-[600px]">
									<span>{displayName}</span>
								</TooltipContent>
							</Tooltip>
						</div>
					)
				},
				enableSorting: true,
			}),
			columnHelper.accessor('file_name', {
				header: 'Filename',
				cell: (info) => {
					const fileName = info.getValue()
					return (
						<div className="max-w-[30vw]">
							<Tooltip>
								<TooltipTrigger asChild>
									<span className="block truncate cursor-help font-medium text-terminal-accent">
										{fileName}
									</span>
								</TooltipTrigger>
								<TooltipContent className="max-w-[600px]">
									<span>{fileName}</span>
								</TooltipContent>
							</Tooltip>
						</div>
					)
				},
				enableSorting: true,
			}),
			columnHelper.accessor('frontmatter', {
				header: 'Type',
				cell: (info) => {
					const raw = info.getValue()
					// Defensive JSONB parsing — Electric sends JSONB as strings
					const frontmatter: Record<string, unknown> | null =
						typeof raw === 'string'
							? (() => {
									try {
										return JSON.parse(raw)
									} catch {
										return null
									}
								})()
							: raw
					if (!frontmatter || typeof frontmatter !== 'object') return null
					const typeValue = frontmatter.type
					if (typeof typeValue !== 'string') return null
					const docType = VALID_DOCUMENT_TYPES.includes(typeValue as DocumentType)
						? (typeValue as DocumentType)
						: null
					return docType ? <DocumentTypeBadge type={docType} /> : null
				},
				enableSorting: false,
			}),
			columnHelper.accessor('comment_count', {
				header: 'Comments',
				cell: (info) => {
					const count = info.getValue()
					if (!count || count === 0) return null
					return (
						<div className="flex items-center gap-1.5 text-muted-foreground">
							<MessageSquare className="h-3.5 w-3.5" />
							<span>{count}</span>
						</div>
					)
				},
				enableSorting: true,
			}),
			columnHelper.accessor('last_updated_at', {
				header: 'Updated',
				cell: (info) => {
					const val = info.getValue()
					if (!val) return '-'
					let date: string
					if (typeof val === 'number') {
						date = new Date(val).toISOString()
					} else if (typeof val === 'bigint') {
						date = new Date(Number(val)).toISOString()
					} else {
						date = val
					}
					return <span className="text-muted-foreground">{formatTimestamp(date)}</span>
				},
				enableSorting: true,
				sortingFn: (rowA, rowB, columnId) => {
					const a = rowA.getValue<string | number | bigint | null>(columnId)
					const b = rowB.getValue<string | number | bigint | null>(columnId)
					return timestampValue(a) - timestampValue(b)
				},
			}),
		],
		[],
	)

	const table = useReactTable({
		data: artifacts,
		columns,
		state: { sorting },
		onSortingChange: setSorting,
		getCoreRowModel: getCoreRowModel(),
		getSortedRowModel: getSortedRowModel(),
		getRowId: (row) => row.id,
	})

	if (isLoading) {
		return <div className="p-8 text-center text-muted-foreground">Loading...</div>
	}

	if (artifacts.length === 0) {
		return <ArtifactsEmptyState />
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
						const isFocused = focusedArtifactId === row.original.id
						const isDeleted = row.original.is_deleted
						return (
							<TableRow
								key={row.id}
								data-artifact-id={row.original.id}
								className={cn(
									'cursor-pointer transition-colors duration-200 border-l-2! border-b-0',
									isFocused
										? ['border-l-[var(--terminal-accent)]!', 'bg-accent/10']
										: ['border-l-transparent!', 'hover:bg-accent/10'],
									isDeleted && 'opacity-40',
								)}
								onClick={() =>
									navigate({ to: '/artifacts/$artifactId', params: { artifactId: row.original.id } })
								}
								onMouseEnter={() => onFocusArtifact?.(row.original)}
								onMouseLeave={() => onBlurArtifact?.()}
							>
								{row.getVisibleCells().map((cell) => (
									<TableCell key={cell.id}>
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
