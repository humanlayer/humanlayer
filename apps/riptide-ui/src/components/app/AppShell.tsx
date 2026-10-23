import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@humanlayer/ui/components/resizable'
import type { ReactNode, Ref } from 'react'
import type { OnPanelResize, PanelImperativeHandle } from 'react-resizable-panels'
import { useDefaultLayout } from 'react-resizable-panels'

import { AppBreadcrumb } from '@/components/AppBreadcrumb'
import { FOCUSED_AREAS } from '@/hooks/stores/focus-areas'
import { useDiffFullscreenDialogOpen } from '@/hooks/stores/taskDiffReviewStore'

export interface AppShellProps {
	/** Content rendered inside the left sidebar. */
	sidebar: ReactNode
	/** Main content rendered below the breadcrumb in the right panel. */
	children: ReactNode
	/**
	 * When `true` (default) the sidebar is a resizable, collapsible panel whose
	 * split is persisted under `layoutKey`. When `false` the sidebar is a static
	 * column sized to its own content — no handle, no collapse — used by the
	 * settings layout, which has a fixed section nav.
	 */
	resizableSidebar?: boolean
	/** localStorage key used to persist the sidebar/main split. Resizable mode only. */
	layoutKey?: string
	/** Imperative handle for the sidebar panel (used to programmatically collapse/expand). Resizable mode only. */
	sidebarPanelRef?: Ref<PanelImperativeHandle>
	/** Called when the sidebar panel is resized. Resizable mode only. */
	onSidebarResize?: OnPanelResize
	/**
	 * When `false`, the shell skips the shared `AppBreadcrumb` row. Routes with a
	 * full-height right sidebar (session/task detail) render the breadcrumb
	 * themselves inside their main column so the sidebar can span the window.
	 */
	showBreadcrumb?: boolean
}

/**
 * The reusable app frame: a left sidebar and a main panel that renders the shared
 * `AppBreadcrumb` above route children.
 *
 * Both the `_app` workspace layout (task tree sidebar) and the `settings` layout
 * (settings section nav) render through this so the surrounding chrome stays
 * consistent. `_app` uses the resizable/collapsible sidebar; `settings` opts into
 * a static, content-width sidebar via `resizableSidebar={false}`.
 */
export function AppShell({ resizableSidebar = true, ...props }: AppShellProps) {
	if (!resizableSidebar) {
		return <StaticAppShell {...props} />
	}
	return <ResizableAppShell {...props} />
}

/** Breadcrumb + route children, shared by both shell variants. */
function MainPanel({ children, showBreadcrumb = true }: { children: ReactNode; showBreadcrumb?: boolean }) {
	return (
		<div className="flex h-full min-h-0 flex-col overflow-hidden" data-focus-area={FOCUSED_AREAS.MAIN}>
			{showBreadcrumb && <AppBreadcrumb />}
			<div className="min-h-0 flex-1 overflow-hidden">{children}</div>
		</div>
	)
}

function ResizableAppShell({
	sidebar,
	children,
	layoutKey,
	sidebarPanelRef,
	onSidebarResize,
	showBreadcrumb,
}: Omit<AppShellProps, 'resizableSidebar'>) {
	const { defaultLayout: savedPanelLayout, onLayoutChanged } = useDefaultLayout({ id: layoutKey ?? 'app-shell' })
	const diffFullscreenOpen = useDiffFullscreenDialogOpen()

	return (
		<ResizablePanelGroup
			orientation="horizontal"
			disabled={diffFullscreenOpen}
			className="h-auto min-h-0 flex-1 overflow-hidden"
			defaultLayout={savedPanelLayout}
			onLayoutChanged={onLayoutChanged}
		>
			<ResizablePanel
				id="app-shell-sidebar"
				defaultSize="25%"
				minSize="320px"
				collapsible
				collapsedSize={0}
				panelRef={sidebarPanelRef}
				onResize={onSidebarResize}
			>
				<div className="h-full" data-focus-area={FOCUSED_AREAS.LEFT_NAV}>
					{sidebar}
				</div>
			</ResizablePanel>
			<ResizableHandle withHandle />
			<ResizablePanel id="main">
				<MainPanel showBreadcrumb={showBreadcrumb}>{children}</MainPanel>
			</ResizablePanel>
		</ResizablePanelGroup>
	)
}

function StaticAppShell({ sidebar, children, showBreadcrumb }: Omit<AppShellProps, 'resizableSidebar'>) {
	return (
		<div className="flex min-h-0 flex-1 overflow-hidden">
			<div className="h-full shrink-0" data-focus-area={FOCUSED_AREAS.LEFT_NAV}>
				{sidebar}
			</div>
			<div className="min-w-0 flex-1 overflow-hidden">
				<MainPanel showBreadcrumb={showBreadcrumb}>{children}</MainPanel>
			</div>
		</div>
	)
}
