import { X } from 'lucide-react'
import type { ReactNode } from 'react'

import { cn } from '../../lib/utils'
import { Button } from '../button'
import { Tabs, TabsList, TabsTrigger } from '../tabs'

export type DiffCommentsPanelFilter = 'unresolved' | 'all'

export interface DiffCommentsPanelProps {
	readonly filter: DiffCommentsPanelFilter
	readonly onFilterChange: (filter: DiffCommentsPanelFilter) => void
	readonly unresolvedCount: number
	readonly totalCount: number
	readonly onClose?: () => void
	readonly className?: string
	readonly children?: ReactNode
}

/**
 * Right-side comments rail for the fullscreen diff review. A Pure layout shell:
 * the header owns the unresolved/all filter tabs and close control, the body
 * renders the caller's thread cards as literal children, and the count-derived
 * empty states cover no-comments and everything-resolved.
 */
export function DiffCommentsPanel({
	filter,
	onFilterChange,
	unresolvedCount,
	totalCount,
	onClose,
	className,
	children,
}: DiffCommentsPanelProps) {
	return (
		<div
			data-diff-comments-panel
			role="region"
			aria-label="Diff comments"
			className={cn('flex h-full min-h-0 flex-col overflow-hidden bg-foreground/3', className)}
		>
			<div className="flex h-9 shrink-0 items-center gap-2 pl-3 pr-1">
				<span className="min-w-0 flex-1 truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">
					Comments
				</span>
				<Tabs
					value={filter}
					onValueChange={(value) => onFilterChange(value as DiffCommentsPanelFilter)}
					className="h-full shrink-0 gap-0"
				>
					<TabsList
						variant="underline"
						className="relative gap-1 after:absolute after:inset-x-0 after:bottom-0 after:z-0 after:h-0.5 after:bg-border/60 after:content-['']"
					>
						<TabsTrigger value="unresolved" className="relative z-10 flex-none px-2 text-xs">
							Unresolved ({unresolvedCount})
						</TabsTrigger>
						<TabsTrigger value="all" className="relative z-10 flex-none px-2 text-xs">
							All ({totalCount})
						</TabsTrigger>
					</TabsList>
				</Tabs>
				{onClose ? (
					<Button
						type="button"
						variant="ghost"
						size="icon"
						className="size-6 shrink-0"
						onClick={onClose}
						aria-label="Hide comments panel"
						title="Hide comments panel"
					>
						<X className="size-3.5" />
					</Button>
				) : null}
			</div>
			<div data-diff-comments-scroll-container className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3">
				{totalCount === 0 ? (
					<p className="px-2 py-4 text-center text-xs text-muted-foreground">
						No comments yet. Select lines in the diff to leave one.
					</p>
				) : filter === 'unresolved' && unresolvedCount === 0 ? (
					<div className="flex flex-col items-center gap-2 px-2 py-4 text-center text-xs text-muted-foreground">
						<span>No unresolved comments.</span>
						<Button type="button" variant="secondary" size="sm" onClick={() => onFilterChange('all')}>
							Show all ({totalCount})
						</Button>
					</div>
				) : (
					children
				)}
			</div>
		</div>
	)
}
