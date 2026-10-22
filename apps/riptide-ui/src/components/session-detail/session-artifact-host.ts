import type { SessionArtifactPresentation } from '@/components/sidebar-widget/SidebarWidgetArtifactViewer'
import type { ArtifactViewerMode } from '@/lib/artifact-viewer-mode'

/** Keep the rendered sidebar branch, its fullscreen scope and overlay fallback in agreement. */
export function deriveSessionArtifactHost({
	selectedArtifactViewerMode,
	fork,
	artifactPanel,
	pendingFullscreenArtifactId,
}: {
	selectedArtifactViewerMode: ArtifactViewerMode
	fork: { showForkSelector: boolean }
	artifactPanel: {
		selectedArtifactId: string | null
		isArtifactFullscreen: boolean
		closeFullscreen: () => void
		openFullscreen: () => void
		presentationHandleRef: SessionArtifactPresentation['handleRef']
	}
	pendingFullscreenArtifactId?: string
}): { sidebarContent: 'fork' | 'widget'; presentation?: SessionArtifactPresentation } {
	if (fork.showForkSelector) return { sidebarContent: 'fork' }
	return {
		sidebarContent: 'widget',
		presentation:
			selectedArtifactViewerMode.kind === 'review'
				? {
						mode: selectedArtifactViewerMode,
						isFullscreen:
							artifactPanel.isArtifactFullscreen ||
							(artifactPanel.selectedArtifactId != null &&
								artifactPanel.selectedArtifactId === pendingFullscreenArtifactId),
						onExit: artifactPanel.closeFullscreen,
						onEnter: artifactPanel.openFullscreen,
						handleRef: artifactPanel.presentationHandleRef,
					}
				: undefined,
	}
}
