import { cn } from '@humanlayer/ui/lib/utils'
import type { ReactNode, RefObject } from 'react'

import { useArtifactViewerStore } from '@/hooks/stores/artifactViewerStore'
import { useMountEffect } from '@/hooks/useMountEffect'

export function SidebarArtifactFocusSurface({
	children,
	containerRef,
	fullscreen = false,
}: {
	children: ReactNode
	containerRef: RefObject<HTMLDivElement | null>
	fullscreen?: boolean
}) {
	useMountEffect(() => {
		useArtifactViewerStore.getState().setSidebarViewerMounted(true)
		return () => {
			useArtifactViewerStore.getState().setSidebarViewerMounted(false)
		}
	})

	return (
		<div
			ref={containerRef}
			data-right-pane-focus-surface={fullscreen ? 'fullscreen' : 'sidebar'}
			data-focus-area={fullscreen ? 'RIGHT_PANE' : undefined}
			tabIndex={-1}
			className={cn(
				'flex flex-col h-full outline-none focus-visible:outline-none',
				fullscreen && 'fixed inset-0 z-50 bg-background',
			)}
		>
			{children}
		</div>
	)
}
