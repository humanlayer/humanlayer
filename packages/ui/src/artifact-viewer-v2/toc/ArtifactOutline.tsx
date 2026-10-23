import { MessageSquareText } from 'lucide-react'

import { cn } from '../../lib/utils'
import type { CountedOutlineItem } from './comment-counts'

export interface ArtifactOutlineProps {
	/** Nested H1–H3 outline entries in document order. */
	items: CountedOutlineItem[]
	/** ID of the clicked/active entry; null when nothing is active. */
	activeItemId: string | null
	/** Fired when an entry row is activated. Navigation is owned by the caller. */
	onItemClick: (item: CountedOutlineItem) => void
	className?: string
}

/**
 * Navigable document outline. Renders nested heading rows from props with
 * active styling; the consuming composition owns heading extraction, active
 * state, and click-to-scroll behavior.
 */
export function ArtifactOutline({ items, activeItemId, onItemClick, className }: ArtifactOutlineProps) {
	return (
		<nav aria-label="Document outline" className={cn('artifact-viewer-v2-outline', className)}>
			{items.length === 0 ? (
				<p className="artifact-viewer-v2-outline-empty">No headings</p>
			) : (
				<OutlineList items={items} activeItemId={activeItemId} onItemClick={onItemClick} />
			)}
		</nav>
	)
}

function OutlineList({
	items,
	activeItemId,
	onItemClick,
}: Pick<ArtifactOutlineProps, 'items' | 'activeItemId' | 'onItemClick'>) {
	return (
		<ul className="artifact-viewer-v2-outline-list">
			{items.map((item) => (
				<li key={item.id}>
					<button
						type="button"
						className="artifact-viewer-v2-outline-row"
						aria-current={item.id === activeItemId ? 'location' : undefined}
						title={item.text}
						onClick={() => onItemClick(item)}
					>
						<span className="artifact-viewer-v2-outline-row-text">{item.text}</span>
						{item.commentCount > 0 ? (
							<span
								className="artifact-viewer-v2-outline-comment-count"
								aria-label={`${item.commentCount} open review ${item.commentCount === 1 ? 'comment' : 'comments'}`}
							>
								<MessageSquareText aria-hidden="true" />
								<span aria-hidden="true">{item.commentCount}</span>
							</span>
						) : null}
					</button>
					{item.children.length > 0 && (
						<OutlineList items={item.children} activeItemId={activeItemId} onItemClick={onItemClick} />
					)}
				</li>
			))}
		</ul>
	)
}
