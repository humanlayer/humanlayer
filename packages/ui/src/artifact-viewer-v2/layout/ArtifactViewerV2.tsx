import type { ReactNode, Ref } from 'react'

import { cn } from '../../lib/utils'

import '../artifact-viewer-v2.css'

export interface ArtifactViewerV2Props {
	children: ReactNode
	className?: string
	ref?: Ref<HTMLDivElement>
}

/**
 * Outer Artifact Viewer V2 shell. Owns only the viewer boundary (layout,
 * theming container). Feature-aware subtrees — header controls, workspace
 * children, review surfaces — are composed by the consuming application,
 * following the KanbanBoard/KanbanColumn compositional pattern.
 */
export function ArtifactViewerV2({ children, className, ref }: ArtifactViewerV2Props) {
	return (
		<div ref={ref} className={cn('artifact-viewer-v2', className)}>
			{children}
		</div>
	)
}
