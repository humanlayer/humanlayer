import { useHotkeys } from '@humanlayer/react-hotkeys-hook'
import type { UserContextShardRow } from '@humanlayer/riptide-api-contract/api/context-shards/list'
import { Button } from '@humanlayer/ui/components/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@humanlayer/ui/components/collapsible'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@humanlayer/ui/components/dialog'
import { Input } from '@humanlayer/ui/components/input'
import { KeyboardShortcut } from '@humanlayer/ui/components/keyboard-shortcut'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@humanlayer/ui/components/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@humanlayer/ui/components/tooltip'
import { formatCompactRelativeTime, formatLocalAbsoluteTime } from '@humanlayer/ui/lib/time-format'
import { cn } from '@humanlayer/ui/lib/utils'
import { ChevronRight, RotateCcw, Search, Trash2 } from 'lucide-react'
import { useCallback, useState } from 'react'

import { HotkeyScopeBoundary } from '@/components/HotkeyScopeBoundary'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'

type ShardSort = 'newest' | 'oldest'
type ShardStatusFilter = 'all' | UserContextShardRow['state']

const sortLabels: Record<ShardSort, string> = {
	newest: 'Newest first',
	oldest: 'Oldest first',
}

const statusFilterLabels: Record<ShardStatusFilter, string> = {
	all: 'All statuses',
	enabled: 'Enabled',
	disabled: 'Disabled',
	dismissed: 'Dismissed',
}

function sortShards(rows: UserContextShardRow[], sort: ShardSort) {
	return [...rows].sort((left, right) => {
		switch (sort) {
			case 'oldest':
				return left.createdAt - right.createdAt
			case 'newest':
			default:
				return right.createdAt - left.createdAt
		}
	})
}

export interface ContextShardsTableProps {
	rows: UserContextShardRow[]
	pendingShardId?: string | null
	onAlwaysOnChange: (shardId: string, enabled: boolean) => void
	onDismiss: (shardId: string) => void
	onRestore: (shardId: string) => void
}

interface ShardGroupProps {
	rows: UserContextShardRow[]
	pendingShardId?: string | null
	onAlwaysOnChange: (shardId: string, enabled: boolean) => void
	onDismissRequest: (shard: UserContextShardRow) => void
	onRestore: (shardId: string) => void
}

function ShardGroup({ rows, pendingShardId, onAlwaysOnChange, onDismissRequest, onRestore }: ShardGroupProps) {
	if (rows.length === 0) return null

	return (
		<div>
			{rows.map((row) => {
				const isEnabled = row.state === 'enabled'
				const isDismissed = row.state === 'dismissed'
				const isPending = pendingShardId === row.id

				return (
					<div
						key={row.id}
						data-shard-id={row.id}
						className={cn(
							'group relative grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 p-4 transition-colors duration-200 hover:bg-muted/10 sm:grid-cols-[minmax(0,1fr)_5rem_8rem]',
							isEnabled &&
								'before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-[var(--terminal-success)] bg-[var(--terminal-success)]/[0.035] hover:bg-[var(--terminal-success)]/[0.06]',
							isDismissed && 'opacity-60',
						)}
					>
						<div className="min-w-0">
							<p className="min-w-0 break-words text-sm leading-6 text-foreground">{row.shardText}</p>
						</div>

						<Tooltip>
							<TooltipTrigger asChild>
								<time
									dateTime={new Date(row.createdAt).toISOString()}
									className="col-start-1 row-start-2 cursor-help text-xs text-muted-foreground sm:col-start-2 sm:row-start-1 sm:pt-1.5"
								>
									{formatCompactRelativeTime(row.createdAt)}
								</time>
							</TooltipTrigger>
							<TooltipContent>{formatLocalAbsoluteTime(row.createdAt)}</TooltipContent>
						</Tooltip>

						<div className="col-start-2 row-span-2 row-start-1 flex items-start justify-end gap-2 sm:col-start-3 sm:row-span-1">
							{isDismissed ? (
								<Button
									type="button"
									size="sm"
									variant="outline"
									disabled={isPending}
									onClick={() => onRestore(row.id)}
								>
									<RotateCcw className="size-3.5" />
									Restore
								</Button>
							) : (
								<>
									<Button
										type="button"
										size="sm"
										variant="outline"
										className={cn(
											isEnabled
												? 'border-destructive/50 text-destructive hover:border-destructive hover:bg-destructive/10 hover:text-destructive'
												: 'border-[var(--terminal-success)]/50 text-[var(--terminal-success)] hover:border-[var(--terminal-success)] hover:bg-[var(--terminal-success)]/10 hover:text-[var(--terminal-success)]',
										)}
										disabled={isPending}
										onClick={() => onAlwaysOnChange(row.id, !isEnabled)}
									>
										{isEnabled ? 'Disable' : 'Enable'}
									</Button>
									<Button
										type="button"
										size="icon"
										variant="ghost"
										className="size-8 text-destructive hover:border-destructive hover:bg-destructive/10 hover:text-destructive focus-visible:border-destructive focus-visible:ring-destructive/50"
										disabled={isPending}
										onClick={() => onDismissRequest(row)}
										aria-label="Dismiss shard"
									>
										<Trash2 className="size-4" />
									</Button>
								</>
							)}
						</div>
					</div>
				)
			})}
		</div>
	)
}

function DismissedShardGroup(props: ShardGroupProps) {
	if (props.rows.length === 0) return null

	return (
		<Collapsible defaultOpen={false}>
			<CollapsibleTrigger className="group flex items-center gap-1 px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring">
				<ChevronRight className="size-3 transition-transform group-data-[state=open]:rotate-90" />
				Dismissed
				<span className="ml-1 text-[10px] font-normal">{props.rows.length}</span>
			</CollapsibleTrigger>
			<CollapsibleContent>
				<ShardGroup {...props} />
			</CollapsibleContent>
		</Collapsible>
	)
}

export function ContextShardsTable({
	rows,
	pendingShardId,
	onAlwaysOnChange,
	onDismiss,
	onRestore,
}: ContextShardsTableProps) {
	const [shardToDismiss, setShardToDismiss] = useState<UserContextShardRow | null>(null)
	const [searchQuery, setSearchQuery] = useState('')
	const [sort, setSort] = useState<ShardSort>('newest')
	const [statusFilter, setStatusFilter] = useState<ShardStatusFilter>('all')
	const dismissDialogOpen = shardToDismiss !== null
	const handleCancelDismiss = useCallback(() => setShardToDismiss(null), [])
	const handleConfirmDismiss = useCallback(() => {
		if (!shardToDismiss) return
		onDismiss(shardToDismiss.id)
		setShardToDismiss(null)
	}, [onDismiss, shardToDismiss])
	useHotkeys(
		'mod+enter',
		(event) => {
			event.preventDefault()
			event.stopPropagation()
			handleConfirmDismiss()
		},
		{
			enabled: dismissDialogOpen,
			enableOnFormTags: true,
			scopes: [HOTKEY_SCOPES.CONTEXT_SHARD_DISMISS_DIALOG],
		},
		[dismissDialogOpen, handleConfirmDismiss],
	)
	useHotkeys(
		'escape',
		(event) => {
			event.preventDefault()
			event.stopPropagation()
			handleCancelDismiss()
		},
		{
			enabled: dismissDialogOpen,
			enableOnFormTags: true,
			scopes: [HOTKEY_SCOPES.CONTEXT_SHARD_DISMISS_DIALOG],
		},
		[dismissDialogOpen, handleCancelDismiss],
	)
	const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase()
	const filteredRows = rows.filter(
		(row) =>
			row.shardText.toLocaleLowerCase().includes(normalizedSearchQuery) &&
			(statusFilter === 'all' || row.state === statusFilter),
	)
	const visibleRows = sortShards(
		filteredRows.filter((row) => row.state !== 'dismissed'),
		sort,
	)
	const dismissedRows = sortShards(
		filteredRows.filter((row) => row.state === 'dismissed'),
		sort,
	)

	if (rows.length === 0) {
		return (
			<div className="border border-dashed border-border p-6 text-sm text-muted-foreground">
				No context shards have been released to your organization yet.
			</div>
		)
	}

	const sharedGroupProps = {
		pendingShardId,
		onAlwaysOnChange,
		onDismissRequest: setShardToDismiss,
		onRestore,
	}

	return (
		<>
			<div className="flex flex-col gap-2 pb-3 sm:flex-row">
				<div className="relative min-w-0 flex-1">
					<Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
					<Input
						value={searchQuery}
						onChange={(event) => setSearchQuery(event.target.value)}
						placeholder="Search context shards..."
						aria-label="Search context shards"
						className="h-8 pl-8 text-xs"
					/>
				</div>
				<Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as ShardStatusFilter)}>
					<SelectTrigger
						size="sm"
						className="w-full text-xs sm:w-36"
						aria-label="Filter context shards by status"
					>
						<SelectValue>{statusFilterLabels[statusFilter]}</SelectValue>
					</SelectTrigger>
					<SelectContent>
						{Object.entries(statusFilterLabels).map(([value, label]) => (
							<SelectItem key={value} value={value}>
								{label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<Select value={sort} onValueChange={(value) => setSort(value as ShardSort)}>
					<SelectTrigger size="sm" className="w-full text-xs sm:w-36" aria-label="Sort context shards">
						<SelectValue>{sortLabels[sort]}</SelectValue>
					</SelectTrigger>
					<SelectContent>
						{Object.entries(sortLabels).map(([value, label]) => (
							<SelectItem key={value} value={value}>
								{label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
			<div className="min-w-0">
				{filteredRows.length === 0 ? (
					<div className="p-6 text-center text-sm text-muted-foreground">
						No context shards match your filters.
					</div>
				) : (
					<>
						<div className="hidden grid-cols-[minmax(0,1fr)_5rem_8rem] gap-x-4 border-b border-border px-4 py-1 text-sm font-medium uppercase tracking-wider text-accent sm:grid">
							<span>Memory</span>
							<span>Created</span>
							<span aria-hidden="true" />
						</div>
						<ShardGroup rows={visibleRows} {...sharedGroupProps} />
						<DismissedShardGroup rows={dismissedRows} {...sharedGroupProps} />
					</>
				)}
			</div>

			<HotkeyScopeBoundary
				scope={HOTKEY_SCOPES.CONTEXT_SHARD_DISMISS_DIALOG}
				isActive={dismissDialogOpen}
				rootScopeDisabled
				componentName="ContextShardDismissDialog"
			>
				<Dialog open={dismissDialogOpen} onOpenChange={(open) => !open && handleCancelDismiss()}>
					<DialogContent onEscapeKeyDown={(event) => event.preventDefault()}>
						<DialogHeader>
							<DialogTitle className="flex items-center gap-2 text-destructive">
								<Trash2 className="size-4" />
								Dismiss context shard?
							</DialogTitle>
							<DialogDescription>
								Are you sure you want to dismiss this shard? It will no longer be used in your sessions.
								You can restore it later.
							</DialogDescription>
						</DialogHeader>
						<DialogFooter>
							<Button variant="secondary" onClick={handleCancelDismiss}>
								Cancel
								<KeyboardShortcut size="xs" className="ml-1">
									Esc
								</KeyboardShortcut>
							</Button>
							<Button variant="destructive" onClick={handleConfirmDismiss}>
								<Trash2 className="size-4" />
								Dismiss
								<KeyboardShortcut size="xs" className="ml-1">
									{typeof navigator !== 'undefined' &&
									navigator.platform.toLowerCase().includes('mac')
										? '⌘+ENTER'
										: 'Ctrl+ENTER'}
								</KeyboardShortcut>
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			</HotkeyScopeBoundary>
		</>
	)
}
