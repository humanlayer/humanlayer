import { ResizablePanel } from '@humanlayer/ui/components/resizable'
import { useState } from 'react'

import { HotkeyScopeBoundary } from '@/components/HotkeyScopeBoundary'
import { RIGHT_PANE_FOCUS_SURFACE_ATTRIBUTE } from '@/components/keyboard-focus-transfer'
import { RightPaneControllerRegistration } from '@/components/RightPaneControllerRegistration'
import { deriveSessionArtifactHost } from '@/components/session-detail/session-artifact-host'
import { useSessionDetail } from '@/components/session-detail/session-detail-context'
import { RightSidebarToggleButton } from '@/components/sidebar-widget/RightSidebarToggleButton'
import { SidebarWidgetHeaderStrip } from '@/components/sidebar-widget/SidebarWidgetHeaderStrip'
import { WiredSidebarWidget } from '@/components/sidebar-widget/WiredSidebarWidget'
import { WiredSessionHostControl } from '@/components/WiredSessionHostControl'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { useMountEffect } from '@/hooks/useMountEffect'

/**
 * The right sidebar panel on the session detail page: a full-window-height,
 * collapsible resizable panel hosting the header strip (host + hotkey legend)
 * and the sidebar widget (minimap / artifacts / fork selector).
 */
export function SessionSidebarPanel({ pendingFullscreenArtifactId }: { pendingFullscreenArtifactId?: string }) {
	const sessionDetail = useSessionDetail()
	const { sessionId, artifactPanel } = sessionDetail
	const artifactHost = deriveSessionArtifactHost({ ...sessionDetail, pendingFullscreenArtifactId })
	const reviewFullscreen = artifactHost.presentation?.isFullscreen === true

	// Scope boundaries stack by activation time, not DOM depth. The persisted
	// artifact selection can be present on the very first render, which would
	// activate the ARTIFACT_PANEL boundary during the initial mount commit —
	// the page-root SESSION_DETAIL boundary's effect runs after it (parent
	// effects follow child effects) and would disable this scope again. Defer
	// activation one commit so this boundary always pushes above the page's.
	const [initialCommitDone, setInitialCommitDone] = useState(false)
	useMountEffect(() => setInitialCommitDone(true))

	return (
		<>
			<RightPaneControllerRegistration
				key={artifactPanel.rightSidebarMode}
				expand={artifactPanel.expandSidebar}
			/>
			<ResizablePanel
				id="sidebar"
				defaultSize="20%"
				collapsible
				collapsedSize={0}
				panelRef={artifactPanel.sidebarPanelRef}
				onResize={(size) => {
					artifactPanel.handleRightSidebarResize(size.asPercentage)
				}}
			>
				<div
					{...{ [RIGHT_PANE_FOCUS_SURFACE_ATTRIBUTE]: 'sidebar' }}
					tabIndex={-1}
					className="flex h-full min-h-0 flex-col outline-none focus-visible:outline-none"
				>
					<SidebarWidgetHeaderStrip>
						<div className="flex min-w-0 flex-1 justify-end text-sm">
							<WiredSessionHostControl sessionId={sessionId} className="max-w-full" />
						</div>
						<RightSidebarToggleButton
							sidebarCollapsed={false}
							onToggleSidebar={artifactPanel.collapseSidebar}
						/>
					</SidebarWidgetHeaderStrip>
					<div className="min-h-0 flex-1">
						{/* Scope registration precedes the viewer's review-target boundary. On a
						    presentation change both update; a parent effect would push the host
						    above the still-active review target. This boundary provides no context. */}
						<HotkeyScopeBoundary
							scope={reviewFullscreen ? HOTKEY_SCOPES.ARTIFACT_FULLSCREEN : HOTKEY_SCOPES.ARTIFACT_PANEL}
							isActive={
								initialCommitDone &&
								artifactHost.sidebarContent === 'widget' &&
								!!artifactPanel.selectedArtifactId
							}
							componentName="SessionArtifactViewer"
						>
							{null}
						</HotkeyScopeBoundary>
						<WiredSidebarWidget pendingFullscreenArtifactId={pendingFullscreenArtifactId} />
					</div>
				</div>
			</ResizablePanel>
		</>
	)
}
