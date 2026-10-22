import type { ReactNode } from 'react'

import { cn } from '../../lib/utils'

export interface ArtifactReviewRailProps {
	/**
	 * Thread children supplied by the consuming composition. Pass `null` for
	 * the real empty state — the rail renders its own placeholder so "no
	 * comments yet" looks the same in every host app.
	 */
	children: ReactNode | null
	className?: string
	/** Ref to the scrollable rail element, for counterpart scroll targeting. */
	ref?: React.Ref<HTMLElement>
}

/**
 * Review-rail layout shell: a complementary landmark beside the document that
 * owns width, scrolling, and the empty state while rendering caller-supplied
 * thread children. Data, ordering, and activation live in the consuming
 * composition.
 */
export function ArtifactReviewRail({ children, className, ref }: ArtifactReviewRailProps) {
	return (
		<aside ref={ref} aria-label="Review comments" className={cn('artifact-viewer-v2-review-rail', className)}>
			{children ?? <p className="artifact-viewer-v2-review-rail-empty">No comments yet</p>}
		</aside>
	)
}
