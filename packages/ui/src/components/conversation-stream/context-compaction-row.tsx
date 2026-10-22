import { ChevronDown, Minimize2 } from 'lucide-react'
import type { KeyboardEvent } from 'react'

import { MarkdownRenderer } from '@humanlayer/ui/components/markdown-renderer'
import { cn } from '@humanlayer/ui/lib/utils'

import { type ContextCompactionPayload, contextCompactionTokensLabel } from './utils/context-compaction'

export interface ContextCompactionRowProps {
	payload: ContextCompactionPayload
	eventId?: string
	isFocused?: boolean
	/** While the composer owns focus the accent bar hides, matching the other row types. */
	isEditorFocused?: boolean
	/** Summary the agent carried across the boundary; when present the row expands to show it. */
	summary?: string
	isSummaryExpanded?: boolean
	onToggleSummary?: () => void
	onMouseEnter?: () => void
	onMouseLeave?: () => void
}

function rowClassName(input: { isFocused: boolean; isEditorFocused: boolean; isExpandable: boolean }): string {
	const focusClasses = input.isFocused
		? cn('bg-accent/5', input.isEditorFocused ? 'border-l-transparent' : 'border-l-[var(--terminal-accent)]')
		: 'border-l-transparent'
	const interactionClasses = input.isExpandable && cn('cursor-pointer', !input.isFocused && 'hover:bg-muted/10')
	return cn('group border-l-2 px-4 py-3 transition-colors duration-200', focusClasses, interactionClasses)
}

function ContextCompactionHeader({
	payload,
	isExpandable,
	isSummaryExpanded,
}: {
	payload: ContextCompactionPayload
	isExpandable: boolean
	isSummaryExpanded: boolean
}) {
	const title = payload.trigger === 'auto' ? 'Context compacted automatically' : 'Context compacted'
	const tokens = contextCompactionTokensLabel(payload)
	return (
		<div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
			{isExpandable ? (
				<ChevronDown className={cn('h-3 w-3 transition-transform', !isSummaryExpanded && '-rotate-90')} />
			) : (
				<Minimize2 aria-hidden="true" className="h-3 w-3" />
			)}
			<span>{title}</span>
			{tokens && <span className="text-muted-foreground/60 normal-case tracking-normal">· {tokens} tokens</span>}
			{isExpandable && !isSummaryExpanded && (
				<span className="text-muted-foreground/60 normal-case tracking-normal">· Summary</span>
			)}
		</div>
	)
}

/** Status row marking a context-compaction boundary, styled like the working-block row. */
export function ContextCompactionRow({
	payload,
	eventId,
	isFocused = false,
	isEditorFocused = false,
	summary,
	isSummaryExpanded = false,
	onToggleSummary,
	onMouseEnter,
	onMouseLeave,
}: ContextCompactionRowProps) {
	const isExpandable = summary !== undefined && onToggleSummary !== undefined
	const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return
		event.preventDefault()
		onToggleSummary?.()
	}
	return (
		<div
			data-event-id={eventId}
			className={rowClassName({ isFocused, isEditorFocused, isExpandable })}
			role={isExpandable ? 'button' : undefined}
			tabIndex={isExpandable ? 0 : undefined}
			aria-expanded={isExpandable ? isSummaryExpanded : undefined}
			onClick={onToggleSummary}
			onKeyDown={isExpandable ? handleKeyDown : undefined}
			onMouseEnter={onMouseEnter}
			onMouseLeave={onMouseLeave}
		>
			<ContextCompactionHeader payload={payload} isExpandable={isExpandable} isSummaryExpanded={isSummaryExpanded} />
			{summary !== undefined && isSummaryExpanded && (
				<div className="mt-2 border-l-2 border-muted/20 pl-3 text-sm" onClick={(event) => event.stopPropagation()}>
					<MarkdownRenderer content={summary} />
				</div>
			)}
		</div>
	)
}
