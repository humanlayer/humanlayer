import { Switch } from '@humanlayer/ui/components/switch'
import { cn } from '@humanlayer/ui/lib/utils'
import { MessageSquareText } from 'lucide-react'
import { type FC, memo, type ReactNode } from 'react'

import { useArtifactListFocusStore } from '@/hooks/stores/artifactListFocusStore'
import { FOCUSED_AREAS } from '@/hooks/stores/focus-areas'
import { useFocusStore } from '@/hooks/stores/focusStore'
import { groupArtifactsByDocumentType } from '@/utils/artifact-document-type'
import { getArtifactIconNode } from '@/utils/artifact-icon'
import type { ArtifactCategory, SessionArtifact } from '@/utils/sidebar-transforms'

const categoryConfig: Record<
	ArtifactCategory,
	{
		label: string
		borderColor: string
		hoverBg: string
		hoverBorder: string
		focusedBg: string
		focusedBorder: string
		focusedBar: string
	}
> = {
	source: {
		label: 'Source',
		borderColor: 'border-[var(--terminal-accent)]/40',
		hoverBg: 'hover:bg-[var(--terminal-accent)]/10',
		hoverBorder: 'hover:border-[var(--terminal-accent)]/70',
		focusedBg: 'bg-[var(--terminal-accent)]/10',
		focusedBorder: 'border-[var(--terminal-accent)]/70',
		focusedBar: 'before:bg-[var(--terminal-accent)]',
	},
	edited: {
		label: 'Edited',
		borderColor: 'border-[var(--terminal-warning)]/40',
		hoverBg: 'hover:bg-[var(--terminal-warning)]/10',
		hoverBorder: 'hover:border-[var(--terminal-warning)]/70',
		focusedBg: 'bg-[var(--terminal-warning)]/10',
		focusedBorder: 'border-[var(--terminal-warning)]/70',
		focusedBar: 'before:bg-[var(--terminal-warning)]',
	},
	new: {
		label: 'New',
		borderColor: 'border-[var(--terminal-success)]/40',
		hoverBg: 'hover:bg-[var(--terminal-success)]/10',
		hoverBorder: 'hover:border-[var(--terminal-success)]/70',
		focusedBg: 'bg-[var(--terminal-success)]/10',
		focusedBorder: 'border-[var(--terminal-success)]/70',
		focusedBar: 'before:bg-[var(--terminal-success)]',
	},
	unreferenced: {
		label: 'Unreferenced',
		borderColor: 'border-[var(--terminal-fg-dim)]/40',
		hoverBg: 'hover:bg-[var(--terminal-fg-dim)]/10',
		hoverBorder: 'hover:border-[var(--terminal-fg-dim)]/70',
		focusedBg: 'bg-[var(--terminal-fg-dim)]/10',
		focusedBorder: 'border-[var(--terminal-fg-dim)]/70',
		focusedBar: 'before:bg-[var(--terminal-fg-dim)]',
	},
}

function getArtifactDisplayPath(path: string): string {
	const normalizedPath = path.replace(/^\.\//, '')
	const taskPathMatch = normalizedPath.match(/(?:^|\/)\.humanlayer\/tasks\/[^/]+\/(.+)$/)
	return taskPathMatch?.[1] ?? normalizedPath
}

export interface ArtifactsListPureProps {
	artifacts: SessionArtifact[]
	onArtifactClick: (artifactId: string) => void
	className?: string
	/** Rendered at the bottom of the scrollable list, beneath the last artifact */
	footerActions?: ReactNode
	attachMenu?: (artifact: SessionArtifact, button: ReactNode) => ReactNode
	/**
	 * When true (default), artifacts are segmented by read/write/edit category headers.
	 * When false, artifacts are shown as a flat list without category headers.
	 */
	segmentByReadWriteEdit?: boolean
	/**
	 * When true, artifacts are grouped by their frontmatter document type
	 * (research, plan, …) instead of read/write status or a flat list.
	 */
	groupByFrontmatterType?: boolean
	/** When provided, renders the "grouped" toggle in the header. */
	onGroupByFrontmatterTypeChange?: (grouped: boolean) => void
	/** Map of artifact id → count of open unresolved comments, used to render the indicator. */
	commentCounts: Record<string, number>
	/** App-side cursor mode. Provider-free demos omit this and render unfocused rows. */
	focusCursor?: 'artifact-list'
	/** Keeps pointer-driven row focus in the same per-surface cursor store. */
	onArtifactPointerDown?: (artifactId: string, index: number) => void
	/** Makes the row under the pointer the target for keyboard actions. */
	onArtifactPointerEnter?: (artifactId: string, index: number) => void
}

interface ArtifactButtonProps {
	artifact: SessionArtifact
	borderColor: string
	hoverBg: string
	hoverBorder: string
	focusedBg: string
	focusedBorder: string
	focusedBar: string
	onArtifactClick: (id: string) => void
	attachMenu?: (artifact: SessionArtifact, button: ReactNode) => ReactNode
	category: ArtifactCategory
	commentCount: number
	isFocused: boolean
	rowIndex: number
	onArtifactPointerDown?: (id: string, index: number) => void
	onArtifactPointerEnter?: (id: string, index: number) => void
}

const ArtifactButton = memo(function ArtifactButton({
	artifact,
	borderColor,
	hoverBg,
	hoverBorder,
	focusedBg,
	focusedBorder,
	focusedBar,
	onArtifactClick,
	attachMenu,
	category,
	commentCount,
	isFocused,
	rowIndex,
	onArtifactPointerDown,
	onArtifactPointerEnter,
}: ArtifactButtonProps) {
	const displayPath = getArtifactDisplayPath(artifact.path)
	const itemIcon = getArtifactIconNode({
		fileName: displayPath,
		category,
		storageType: artifact.storageType,
	})
	const hasComments = commentCount > 0

	const button = (
		<button
			type="button"
			data-artifact-list-row-id={artifact.id}
			data-artifact-list-row-index={rowIndex}
			data-artifact-list-focused={isFocused ? 'true' : undefined}
			onPointerDown={() => artifact.id && onArtifactPointerDown?.(artifact.id, rowIndex)}
			onPointerEnter={() => artifact.id && onArtifactPointerEnter?.(artifact.id, rowIndex)}
			onClick={() => artifact.id && onArtifactClick(artifact.id)}
			className={cn(
				'relative flex items-center gap-3 w-full rounded-none text-left',
				'py-2 pl-3 pr-10 border cursor-pointer',
				borderColor,
				'bg-transparent',
				hoverBg,
				hoverBorder,
				'active:opacity-80',
				'transition-colors',
				'text-[var(--terminal-fg)]',
				isFocused && [
					focusedBg,
					focusedBorder,
					focusedBar,
					"before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:content-['']",
				],
			)}
		>
			{itemIcon}
			<span className="truncate text-xs flex-1 min-w-0">{displayPath}</span>
			<span
				className={cn(
					'ml-auto flex items-center gap-1 text-xs flex-shrink-0',
					hasComments ? 'opacity-100' : 'opacity-30',
				)}
			>
				<MessageSquareText className="h-3 w-3" />
				<span className="tabular-nums">{commentCount}</span>
			</span>
		</button>
	)

	return attachMenu ? attachMenu(artifact, button) : button
})

const WiredArtifactButton = memo(function WiredArtifactButton(props: Omit<ArtifactButtonProps, 'isFocused'>) {
	const rightPaneFocused = useFocusStore((state) => state.focusedArea === FOCUSED_AREAS.RIGHT_PANE)
	const isFocused = useArtifactListFocusStore(
		(state) =>
			rightPaneFocused &&
			state.focusedArtifactId === props.artifact.id &&
			state.focusedArtifactIndex === props.rowIndex,
	)
	return <ArtifactButton {...props} isFocused={isFocused} />
})

export const ArtifactsListPure: FC<ArtifactsListPureProps> = ({
	artifacts,
	onArtifactClick,
	className,
	footerActions,
	attachMenu,
	segmentByReadWriteEdit = true,
	groupByFrontmatterType = false,
	onGroupByFrontmatterTypeChange,
	commentCounts,
	focusCursor,
	onArtifactPointerDown,
	onArtifactPointerEnter,
}) => {
	let artifactRenderIndex = 0
	const getCommentCount = (artifact: SessionArtifact): number => (artifact.id ? (commentCounts[artifact.id] ?? 0) : 0)

	const renderArtifactItem = (artifact: SessionArtifact, category: ArtifactCategory) => {
		const { borderColor, hoverBg, hoverBorder, focusedBg, focusedBorder, focusedBar } = categoryConfig[category]
		const rowIndex = artifactRenderIndex++
		const buttonProps = {
			artifact,
			borderColor,
			hoverBg,
			hoverBorder,
			focusedBg,
			focusedBorder,
			focusedBar,
			onArtifactClick,
			attachMenu,
			category,
			commentCount: getCommentCount(artifact),
			rowIndex,
			onArtifactPointerDown,
			onArtifactPointerEnter,
		}
		return (
			<li key={artifact.path}>
				{focusCursor ? (
					<WiredArtifactButton {...buttonProps} />
				) : (
					<ArtifactButton {...buttonProps} isFocused={false} />
				)}
			</li>
		)
	}

	// Rendered on its own header row, beneath the counts / header actions
	const groupToggle = onGroupByFrontmatterTypeChange ? (
		<label
			htmlFor="artifacts-group-by-type-switch"
			className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-[var(--terminal-fg-dim)]"
		>
			<Switch
				id="artifacts-group-by-type-switch"
				checked={groupByFrontmatterType}
				onCheckedChange={onGroupByFrontmatterTypeChange}
			/>
			<span>Grouped</span>
		</label>
	) : null

	const emptyState =
		artifacts.length === 0 ? (
			<div className="text-[var(--terminal-fg-dim)] text-xs py-4 text-center border border-dashed border-[var(--terminal-fg-dim)]/30">
				No artifacts yet
			</div>
		) : null

	const footer = footerActions ? <div className="mt-2 flex items-center justify-end">{footerActions}</div> : null

	// Grouped by frontmatter document type: one section per type (research, plan, …).
	// Each artifact keeps its own read/write category color as a secondary label.
	if (groupByFrontmatterType) {
		const groups = groupArtifactsByDocumentType(artifacts)
		return (
			<div className={cn('flex flex-col h-full font-mono', className)}>
				{groupToggle && <header className="flex flex-col gap-1 mb-3 flex-shrink-0">{groupToggle}</header>}
				<div className="flex-1 overflow-y-auto min-h-0 space-y-4">
					{groups.map((group) => (
						<section key={group.type ?? 'untyped'}>
							<h3 className="text-xs font-medium text-[var(--terminal-fg-dim)] mb-2 uppercase tracking-wider">
								{group.label} ({group.items.length})
							</h3>
							<ul className="space-y-1.5">
								{group.items.map((artifact) =>
									renderArtifactItem(artifact, artifact.categories[0] ?? 'unreferenced'),
								)}
							</ul>
						</section>
					))}
					{emptyState}
					{footer}
				</div>
			</div>
		)
	}

	// Flat list: all artifacts in a single unsegmented list
	if (!segmentByReadWriteEdit) {
		return (
			<div className={cn('flex flex-col h-full font-mono', className)}>
				{groupToggle && <header className="flex flex-col gap-1 mb-3 flex-shrink-0">{groupToggle}</header>}
				<div className="flex-1 overflow-y-auto min-h-0">
					<ul className="space-y-1.5">
						{artifacts.map((artifact) =>
							renderArtifactItem(artifact, artifact.categories[0] ?? 'unreferenced'),
						)}
					</ul>
					{emptyState}
					{footer}
				</div>
			</div>
		)
	}

	const byCategory = {
		source: artifacts.filter((a) => a.categories.includes('source')),
		edited: artifacts.filter((a) => a.categories.includes('edited')),
		new: artifacts.filter((a) => a.categories.includes('new')),
		unreferenced: artifacts.filter((a) => a.categories.includes('unreferenced')),
	}

	const sourceCount = byCategory.source.length
	const editedCount = byCategory.edited.length
	const newCount = byCategory.new.length
	const unreferencedCount = byCategory.unreferenced.length

	return (
		<div className={cn('flex flex-col h-full font-mono', className)}>
			<header className="flex flex-col gap-1 mb-3 flex-shrink-0">
				<div className="flex items-center gap-2">
					<div className="text-xs text-[var(--terminal-fg-dim)]">
						<span className="text-[var(--terminal-accent)]">{sourceCount} src</span>
						{' · '}
						<span className="text-[var(--terminal-warning)]">{editedCount} edit</span>
						{' · '}
						<span className="text-[var(--terminal-success)]">{newCount} new</span>
						{unreferencedCount > 0 && (
							<>
								{' · '}
								<span className="text-[var(--terminal-fg-dim)]">{unreferencedCount} other</span>
							</>
						)}
					</div>
				</div>
				{groupToggle}
			</header>
			<div className="flex-1 overflow-y-auto min-h-0 space-y-4">
				{(['new', 'edited', 'source', 'unreferenced'] as const).map((category) => {
					const items = byCategory[category]
					if (items.length === 0) return null

					const { label } = categoryConfig[category]
					return (
						<section key={category}>
							<h3 className="text-xs font-medium text-[var(--terminal-fg-dim)] mb-2 uppercase tracking-wider">
								{label} ({items.length})
							</h3>
							<ul className="space-y-1.5">
								{items.map((artifact) => renderArtifactItem(artifact, category))}
							</ul>
						</section>
					)
				})}
				{emptyState}
				{footer}
			</div>
		</div>
	)
}
