import type { HostProcessGroup } from '@humanlayer/db/tables/online-hosts'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@humanlayer/ui/components/collapsible'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@humanlayer/ui/components/table'
import { cn } from '@humanlayer/ui/lib/utils'
import { ArrowDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'

import {
	cpuLevel,
	formatMemory,
	formatProcessGroupName,
	formatProcessShare,
	type PressureLevel,
	type ProcessGroupSort,
	sortProcessGroups,
} from '@/lib/host-stats'

const LEVEL_TEXT: Record<PressureLevel, string> = {
	ok: 'text-foreground',
	warn: 'text-[var(--terminal-warning)]',
	crit: 'text-[var(--terminal-error)]',
}

const LEVEL_FILL: Record<PressureLevel, string> = {
	ok: 'bg-[var(--terminal-success)]',
	warn: 'bg-[var(--terminal-warning)]',
	crit: 'bg-[var(--terminal-error)]',
}

const HEAD_CLASS = 'h-7 px-2 font-mono text-[10px] font-normal uppercase tracking-wider text-muted-foreground'
const NUMERIC_HEAD_CLASS = cn(HEAD_CLASS, 'text-right')
const CELL_CLASS = 'px-2 py-1 font-mono text-[11px] tabular-nums'

function SortableHead({
	label,
	sort,
	activeSort,
	onSort,
}: {
	label: string
	sort: ProcessGroupSort
	activeSort: ProcessGroupSort
	onSort: (sort: ProcessGroupSort) => void
}) {
	const active = sort === activeSort
	return (
		<TableHead className={NUMERIC_HEAD_CLASS} aria-sort={active ? 'descending' : 'none'}>
			<button
				type="button"
				className={cn('inline-flex items-center gap-1 uppercase tracking-wider', active && 'text-foreground')}
				onClick={() => onSort(sort)}
			>
				{label}
				<ArrowDown aria-hidden className={cn('size-3', !active && 'invisible')} />
			</button>
		</TableHead>
	)
}

function CpuCell({ cpuPct }: { cpuPct: number }) {
	const level = cpuLevel(cpuPct)
	return (
		<span className="flex items-center justify-end gap-2">
			<span className="relative block h-1 w-12 bg-foreground/10">
				<span
					className={cn('absolute inset-y-0 left-0 block', LEVEL_FILL[level])}
					style={{ width: `${Math.min(100, cpuPct)}%` }}
				/>
			</span>
			<span className={cn('w-12 text-right', LEVEL_TEXT[level])}>{formatProcessShare(cpuPct)}</span>
		</span>
	)
}

export function HostTopProcesses({
	groups,
	memTotalBytes,
}: {
	groups: readonly HostProcessGroup[]
	memTotalBytes: number
}) {
	const [sort, setSort] = useState<ProcessGroupSort>('cpu')
	if (groups.length === 0) return null
	const busiest = sortProcessGroups(groups, 'cpu')[0]

	return (
		<Collapsible defaultOpen={false} className="mt-3">
			<CollapsibleTrigger className="group/processes flex items-center gap-1 font-mono text-[10px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring">
				<ChevronRight
					aria-hidden
					className="size-3 transition-transform group-data-[state=open]/processes:rotate-90"
				/>
				<span className="uppercase tracking-wider">Top processes</span>
				{busiest && (
					<span className="ml-2">
						{formatProcessGroupName(busiest)} busiest at {formatProcessShare(busiest.cpuPct)} CPU
					</span>
				)}
			</CollapsibleTrigger>
			<CollapsibleContent>
				<Table className="mt-1">
					<TableHeader>
						<TableRow>
							<TableHead className={HEAD_CLASS}>Process</TableHead>
							<TableHead className={NUMERIC_HEAD_CLASS}>Count</TableHead>
							<SortableHead label="CPU" sort="cpu" activeSort={sort} onSort={setSort} />
							<SortableHead label="Memory" sort="memory" activeSort={sort} onSort={setSort} />
							<TableHead className={NUMERIC_HEAD_CLASS}>Share of RAM</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{sortProcessGroups(groups, sort).map((group) => (
							<TableRow key={`${group.startedByDaemon ? 'daemon' : 'other'}:${group.name}`}>
								<TableCell className={cn(CELL_CLASS, 'max-w-0 truncate')}>
									{group.name}
									{group.startedByDaemon && (
										<span className="ml-2 text-[10px] text-[var(--terminal-accent)]">
											HumanLayer
										</span>
									)}
								</TableCell>
								<TableCell className={cn(CELL_CLASS, 'w-16 text-right text-muted-foreground')}>
									{group.processCount}
								</TableCell>
								<TableCell className={cn(CELL_CLASS, 'w-32')}>
									<CpuCell cpuPct={group.cpuPct} />
								</TableCell>
								<TableCell className={cn(CELL_CLASS, 'w-20 text-right')}>
									{formatMemory(group.memBytes)}
								</TableCell>
								<TableCell className={cn(CELL_CLASS, 'w-24 text-right text-muted-foreground')}>
									{formatProcessShare(memTotalBytes > 0 ? (group.memBytes / memTotalBytes) * 100 : 0)}
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
				<p className="mt-1 px-2 font-mono text-[10px] text-muted-foreground">
					CPU is the share of the whole host since the previous sample. Processes that start and exit between
					samples are not counted.
				</p>
			</CollapsibleContent>
		</Collapsible>
	)
}
