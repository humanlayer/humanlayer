import type { ReactNode } from 'react'

import { cn } from '../../lib/utils'

export interface SelectionToolbarProps {
	/**
	 * Viewport rectangle of the active selection. The toolbar floats centered
	 * just above it (plannotator's `center-above` geometry), clamped to the
	 * viewport edges.
	 */
	rect: DOMRect
	/**
	 * Action controls composed by the caller (Slice 5 supplies Comment and
	 * Dismiss; later slices insert typed actions without changing this shell).
	 */
	children: ReactNode
	className?: string
}

/** Height reserved above the selection for the floating bar. */
const TOOLBAR_OFFSET_PX = 44

/**
 * Floating selection toolbar shell for Artifact Viewer V2. Positioned from the
 * selection rectangle and rendering caller-supplied action children — it owns
 * layout, positioning, and the accessibility landmark, never the actions
 * themselves. Later slices compose typed action children into the same shell.
 */
export function SelectionToolbar({ rect, children, className }: SelectionToolbarProps) {
	const viewportWidth = typeof window === 'undefined' ? rect.right : window.innerWidth
	const top = Math.max(8, rect.top - TOOLBAR_OFFSET_PX)
	const centerX = rect.left + rect.width / 2
	const left = Math.min(Math.max(centerX, 8), viewportWidth - 8)

	return (
		<div
			role="toolbar"
			aria-label="Selection actions"
			className={cn('artifact-viewer-v2-selection-toolbar fixed z-50', className)}
			style={{ top, left, transform: 'translateX(-50%)' }}
			// The toolbar is a viewer-chrome surface; keep pointer interactions from
			// clearing the underlying selection.
			onMouseDown={(event) => event.preventDefault()}
		>
			<div className="flex items-center gap-0.5 rounded-md border border-border bg-popover p-0.5 shadow-lg">
				{children}
			</div>
		</div>
	)
}
