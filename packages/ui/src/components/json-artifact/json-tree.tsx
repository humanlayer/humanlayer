import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { type KeyboardEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { cn } from '../../lib/utils'
import type { JsonArtifactSearchMatch } from './json-artifact-search'
import type { JsonTreeModelResult, JsonTreeRow } from './json-tree-model'
import { flattenVisibleRows, getDefaultExpandedIds } from './json-tree-model'
import { getSearchExpandedIds } from './json-artifact-search'

type JsonTreeModel = Extract<JsonTreeModelResult, { kind: 'model' }>
type JsonTreeDisplayRow =
	| { kind: 'value'; row: JsonTreeRow; visibleIndex: number }
	| { kind: 'close'; id: string; depth: number; token: string; comma: boolean }

function getContainerTokens(row: JsonTreeRow): { open: string; close: string } {
	const value = row.value
	return Array.isArray(value) ? { open: '[', close: ']' } : { open: '{', close: '}' }
}

function getCollapsedCopyBody(row: JsonTreeRow): string {
	const serialized = JSON.stringify(row.value, null, 2)
	return serialized.slice(1, -1)
}

function getTreeLabel(row: JsonTreeRow): string {
	const prefix = row.key === null ? 'JSON' : `${row.key}:`
	if (row.isContainer) {
		const kind = Array.isArray(row.value) ? 'array' : 'object'
		return `${prefix} ${kind}`
	}
	return row.key === null ? row.displayValue : `${prefix} ${row.displayValue}`
}

function getAncestorRows(model: JsonTreeModel, row: JsonTreeRow): JsonTreeRow[] {
	const ancestors: JsonTreeRow[] = []
	let current: JsonTreeRow | undefined = row
	while (current) {
		ancestors.unshift(current)
		current = current.parentId === null ? undefined : model.rowsById.get(current.parentId)
	}
	return ancestors
}

function buildDisplayRows(
	model: JsonTreeModel,
	visibleRows: JsonTreeRow[],
	expandedIds: ReadonlySet<string>,
): JsonTreeDisplayRow[] {
	const result: JsonTreeDisplayRow[] = []
	for (let index = 0; index < visibleRows.length; index++) {
		const row = visibleRows[index]!
		result.push({ kind: 'value', row, visibleIndex: index })
		const nextIds = new Set(
			visibleRows[index + 1] ? getAncestorRows(model, visibleRows[index + 1]!).map((item) => item.id) : [],
		)
		const openContainers = getAncestorRows(model, row).filter(
			(item) => item.isContainer && expandedIds.has(item.id) && !nextIds.has(item.id),
		)
		for (const container of openContainers.reverse()) {
			result.push({
				kind: 'close',
				id: `${container.id}:close`,
				depth: container.depth,
				token: getContainerTokens(container).close,
				comma: container.parentId !== null && container.indexInParent < container.setSize - 1,
			})
		}
	}
	return result
}

function HighlightedText({
	text,
	matches,
	active,
}: {
	text: string
	matches: JsonArtifactSearchMatch[]
	active?: JsonArtifactSearchMatch
}) {
	if (matches.length === 0) return text
	const parts: ReactNode[] = []
	let from = 0
	for (const match of matches) {
		parts.push(text.slice(from, match.start))
		parts.push(
			<mark
				key={`${match.start}-${match.field}`}
				data-json-search-active={match === active || undefined}
				className={cn(
					'bg-warning/20 text-inherit',
					match === active && 'bg-warning/60 outline outline-1 outline-warning',
				)}
			>
				{text.slice(match.start, match.start + match.length)}
			</mark>,
		)
		from = match.start + match.length
	}
	parts.push(text.slice(from))
	return parts
}

export interface JsonTreeProps {
	model: JsonTreeModel
	matches?: JsonArtifactSearchMatch[]
	activeMatchIndex?: number
}

export function JsonTree({ model, matches = [], activeMatchIndex = 0 }: JsonTreeProps) {
	const scrollRef = useRef<HTMLDivElement>(null)
	const [baseExpandedIds, setBaseExpandedIds] = useState(() => getDefaultExpandedIds(model))
	const [focusedId, setFocusedId] = useState(model.rows[0]?.id ?? '')
	useEffect(() => {
		setBaseExpandedIds(getDefaultExpandedIds(model))
		setFocusedId(model.rows[0]?.id ?? '')
	}, [model])
	const searchExpandedIds = useMemo(() => getSearchExpandedIds(model, matches), [model, matches])
	const expandedIds = useMemo(
		() => new Set([...baseExpandedIds, ...searchExpandedIds]),
		[baseExpandedIds, searchExpandedIds],
	)
	const visibleRows = useMemo(() => flattenVisibleRows(model, expandedIds), [model, expandedIds])
	const displayRows = useMemo(() => buildDisplayRows(model, visibleRows, expandedIds), [expandedIds, model, visibleRows])
	useEffect(() => {
		if (visibleRows.some((row) => row.id === focusedId)) return
		let candidate = model.rowsById.get(focusedId)?.parentId ?? null
		while (candidate !== null && !visibleRows.some((row) => row.id === candidate)) {
			candidate = model.rowsById.get(candidate)?.parentId ?? null
		}
		setFocusedId(candidate ?? visibleRows[0]?.id ?? '')
	}, [focusedId, model, visibleRows])
	const virtualizer = useVirtualizer({
		count: displayRows.length,
		getScrollElement: () => scrollRef.current,
		estimateSize: () => 28,
		overscan: 12,
		initialRect: { width: 800, height: 560 },
	})
	const activeMatch = matches[activeMatchIndex]

	const focusIndex = useCallback(
		(index: number) => {
			const bounded = Math.max(0, Math.min(index, visibleRows.length - 1))
			const row = visibleRows[bounded]
			if (!row) return
			setFocusedId(row.id)
			const displayIndex = displayRows.findIndex((item) => item.kind === 'value' && item.row.id === row.id)
			virtualizer.scrollToIndex(displayIndex, { align: 'auto' })
			requestAnimationFrame(() => {
				const elements = scrollRef.current?.querySelectorAll<HTMLElement>('[data-json-row-id]') ?? []
				Array.from(elements)
					.find((element) => element.dataset.jsonRowId === row.id)
					?.focus()
			})
		},
		[displayRows, visibleRows, virtualizer],
	)

	useEffect(() => {
		if (!activeMatch) return
		const index = displayRows.findIndex((item) => item.kind === 'value' && item.row.id === activeMatch.rowId)
		if (index !== -1) virtualizer.scrollToIndex(index, { align: 'auto' })
	}, [activeMatch, displayRows, virtualizer])

	const toggle = (id: string) => {
		setBaseExpandedIds((current) => {
			const next = new Set(current)
			if (next.has(id)) next.delete(id)
			else next.add(id)
			return next
		})
	}

	const onKeyDown = (event: KeyboardEvent, index: number, row: JsonTreeRow) => {
		switch (event.key) {
			case 'ArrowDown':
				focusIndex(index + 1)
				break
			case 'ArrowUp':
				focusIndex(index - 1)
				break
			case 'Home':
				focusIndex(0)
				break
			case 'End':
				focusIndex(visibleRows.length - 1)
				break
			case 'Enter':
			case ' ':
				if (row.isContainer) toggle(row.id)
				break
			case 'ArrowRight':
				if (row.isContainer && !expandedIds.has(row.id)) toggle(row.id)
				else if (row.isContainer) focusIndex(index + 1)
				break
			case 'ArrowLeft':
				if (row.isContainer && expandedIds.has(row.id)) toggle(row.id)
				else if (row.parentId !== null) {
					focusIndex(visibleRows.findIndex((item) => item.id === row.parentId))
				}
				break
			default:
				return
		}
		event.preventDefault()
	}

	return (
		<div
			ref={scrollRef}
			role="tree"
			aria-label="JSON"
			className="h-full min-h-0 w-full overflow-auto bg-transparent p-6 font-mono text-[13px] leading-5 text-foreground"
		>
			<div className="relative w-max min-w-full" style={{ height: virtualizer.getTotalSize() }}>
				{virtualizer.getVirtualItems().map((virtualRow) => {
					const displayRow = displayRows[virtualRow.index]!
					if (displayRow.kind === 'close') {
						return (
							<div
								key={displayRow.id}
								aria-hidden
								className="absolute left-0 top-0 flex h-7 min-w-full select-text items-center whitespace-nowrap py-0 pr-0 pl-2"
								style={{
									transform: `translateY(${virtualRow.start}px)`,
									paddingLeft: `${28 + displayRow.depth * 16}px`,
								}}
							>
								{displayRow.token}
								{displayRow.comma && ','}
							</div>
						)
					}
					const { row, visibleIndex } = displayRow
					const rowMatches = matches.filter((match) => match.rowId === row.id)
					const keyMatches = rowMatches.filter((match) => match.field === 'key')
					const valueMatches = rowMatches.filter((match) => match.field === 'value')
					return (
						<div
							key={row.id}
							role="treeitem"
							aria-level={row.depth + 1}
							aria-posinset={row.indexInParent + 1}
							aria-setsize={row.setSize}
							aria-expanded={row.isContainer ? expandedIds.has(row.id) : undefined}
							aria-label={getTreeLabel(row)}
							tabIndex={focusedId === row.id ? 0 : -1}
							data-json-row-index={visibleIndex}
							data-json-row-id={row.id}
							data-json-tree-label={getTreeLabel(row)}
							className={cn(
								'group/json-child absolute left-0 top-0 flex h-7 min-w-full select-text items-center whitespace-nowrap border-l-2 border-l-transparent py-0 pr-0 pl-2 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
								row.isContainer &&
									'cursor-pointer hover:border-l-[var(--terminal-accent)] hover:bg-accent/10',
							)}
							style={{
								transform: `translateY(${virtualRow.start}px)`,
								paddingLeft: `${8 + row.depth * 16}px`,
							}}
							onFocus={() => setFocusedId(row.id)}
							onKeyDown={(event) => onKeyDown(event, visibleIndex, row)}
							onClick={() => row.isContainer && toggle(row.id)}
						>
							{row.isContainer ? (
								<button
									type="button"
									tabIndex={-1}
									data-json-node-toggle="true"
									className="group/json-toggle mr-0.5 flex size-4 shrink-0 touch-manipulation items-center justify-center rounded text-muted-foreground group-hover/json-child:text-foreground group-focus-visible/json-child:text-foreground"
									aria-hidden
								>
									{expandedIds.has(row.id) ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
								</button>
							) : (
								<span aria-hidden className="mr-0.5 size-4 shrink-0" />
							)}
							{row.key !== null && (
								<>
									<span className="mr-[0.5ch] font-normal text-[var(--terminal-accent)]">
										<HighlightedText text={row.key} matches={keyMatches} active={activeMatch} />
										<span>:</span>
										<span className="sr-only"> </span>
									</span>
								</>
							)}
							{row.isContainer ? (
								<span>
									{getContainerTokens(row).open}
									{!expandedIds.has(row.id) && (
										<>
											<span className="sr-only whitespace-pre">{getCollapsedCopyBody(row)}</span>
											<span aria-hidden className="text-muted-foreground after:content-['…']" />
											{getContainerTokens(row).close}
										</>
									)}
								</span>
							) : (
								<span
									className={cn(
										row.rowKind === 'invalid' && 'text-error',
										row.rowKind === 'blank' && 'italic text-muted-foreground',
										typeof row.value === 'string' && 'text-[var(--terminal-success)]',
										typeof row.value === 'number' && 'text-[var(--terminal-warning)]',
										typeof row.value === 'boolean' && 'text-[var(--terminal-accent)]',
										row.value === null && row.rowKind === 'value' && 'text-muted-foreground',
									)}
								>
									<HighlightedText text={row.displayValue} matches={valueMatches} active={activeMatch} />
								</span>
							)}
							{(!row.isContainer || !expandedIds.has(row.id)) &&
								row.parentId !== null &&
								row.indexInParent < row.setSize - 1 && <span>,</span>}
							{row.rowKind === 'invalid' && row.message && (
								<span className="ml-3 text-xs text-muted-foreground">{row.message}</span>
							)}
						</div>
					)
				})}
			</div>
		</div>
	)
}
