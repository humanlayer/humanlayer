import { useIsMobile } from '@humanlayer/ui/hooks/use-mobile'
import { createFileRoute, Outlet, useRouterState } from '@tanstack/react-router'
import { useLayoutEffect, useRef } from 'react'
import type { PanelImperativeHandle } from 'react-resizable-panels'

import { AppShell } from '@/components/app/AppShell'
import { BillingBannerRail } from '@/components/BillingBannerRail'
import { KeyboardAreaArbiter } from '@/components/KeyboardAreaArbiter'
import { MinimalistTryBanner } from '@/components/MinimalistTryBanner'
import { NetworkOfflineBanner } from '@/components/NetworkOfflineBanner'
import { ProjectSidebarV2 } from '@/components/project-sidebar/ProjectSidebarV2'
import { WiredSidebarTaskTree } from '@/components/sidebar-task-tree/WiredSidebarTaskTree'
import { SyncOfflineBanner } from '@/components/SyncOfflineBanner'
import { ViewportFileDropOverlay } from '@/components/ViewportFileDropOverlay'
import { useFocusStore } from '@/hooks/stores/focusStore'
import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { useSidebarStore } from '@/hooks/stores/sidebarStore'
import { useMinimalistLayout } from '@/hooks/use-minimalist-layout'
import { useMountEffect } from '@/hooks/useMountEffect'
import { clearLegacyLocalStorage } from '@/lib/localStorage'
import { LEFT_SIDEBAR_PANEL_LAYOUT_KEY } from '@/lib/preferences'
import { AppShell as MinimalistAppShell } from '@/minimalist/components/AppShell'

export const Route = createFileRoute('/_app')({
	component: AppLayout,
})

function AppLayout() {
	const minimalist = useMinimalistLayout()
	if (minimalist)
		return (
			<MinimalistAppShell>
				<Outlet />
			</MinimalistAppShell>
		)
	return <StandardAppLayout />
}

function StandardAppLayout() {
	const pathname = useRouterState({ select: (s) => s.location.pathname })
	// Session/task detail render the breadcrumb inside their main column so the
	// full-height right sidebar can span the window top-to-bottom.
	const pageOwnsBreadcrumb = useRouterState({
		select: (s) =>
			s.matches.some((m) => m.routeId === '/_app/sessions/$sessionId' || m.routeId === '/_app/tasks/$taskId'),
	})
	const prevPathnameRef = useRef<string | null>(null)
	const sidebarPanelRef = useRef<PanelImperativeHandle>(null)
	const sidebarInteractedRef = useRef(false)
	const isMobile = useIsMobile()
	const sidebarCollapsed = useSidebarStore((state) => state.sidebarCollapsed)
	const setSidebarCollapsed = useSidebarStore((state) => state.setSidebarCollapsed)

	useMountEffect(() => {
		clearLegacyLocalStorage()
	})

	// Clear focus state on navigation using useLayoutEffect so it runs
	// synchronously after DOM mutations but before the browser paints,
	// preventing the race condition where onMouseEnter fires before the
	// focus state is cleared.
	useLayoutEffect(() => {
		if (prevPathnameRef.current !== null && prevPathnameRef.current !== pathname) {
			useFocusStore.getState().clearFocus()
		}
		prevPathnameRef.current = pathname
	}, [pathname])

	useLayoutEffect(() => {
		const panel = sidebarPanelRef.current
		if (!panel) return

		if (sidebarCollapsed) {
			panel.collapse()
		} else if (panel.isCollapsed()) {
			panel.expand()
		}
	}, [sidebarCollapsed])

	const handleSidebarResize = (size: { asPercentage: number }) => {
		if (!sidebarInteractedRef.current) {
			if (size.asPercentage > 0) sidebarInteractedRef.current = true
			return
		}
		setSidebarCollapsed(size.asPercentage === 0)
	}

	if (isMobile) {
		return (
			<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
				<KeyboardAreaArbiter />
				<ViewportFileDropOverlay />
				<NetworkOfflineBanner />
				<SyncOfflineBanner />
				<Outlet />
			</div>
		)
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
			<KeyboardAreaArbiter />
			<ViewportFileDropOverlay />
			<NetworkOfflineBanner />
			<SyncOfflineBanner />
			<BillingBannerRail />
			<MinimalistTryBanner />
			<AppShell
				layoutKey={LEFT_SIDEBAR_PANEL_LAYOUT_KEY}
				sidebarPanelRef={sidebarPanelRef}
				onSidebarResize={handleSidebarResize}
				sidebar={<AppSidebar />}
				showBreadcrumb={!pageOwnsBreadcrumb}
			>
				<Outlet />
			</AppShell>
		</div>
	)
}

function AppSidebar() {
	const projectsV2Enabled = useSettingsStore((state) => state.projectsV2Enabled)
	return projectsV2Enabled ? <ProjectSidebarV2 /> : <WiredSidebarTaskTree />
}
