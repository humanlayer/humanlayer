import type { ReactNode, Ref } from 'react'

import { cn } from '../../lib/utils'

export interface ArtifactDocumentProps {
	children: ReactNode
	className?: string
	/**
	 * Ref to the scrollable document region itself. Consuming compositions use
	 * it (typically as a callback ref) to observe reading position and derive
	 * keyboard-navigation geometry from the document's own scroll container
	 * rather than the window.
	 */
	ref?: Ref<HTMLElement>
}

/**
 * Scrollable main-document region of the V2 workspace. Exposes a named region
 * landmark around the rendered document child.
 */
export function ArtifactDocument({ children, className, ref }: ArtifactDocumentProps) {
	return (
		<section ref={ref} aria-label="Artifact document" className={cn('artifact-viewer-v2-document', className)}>
			{children}
		</section>
	)
}
