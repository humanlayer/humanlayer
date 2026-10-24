import { CodeLayerToaster } from '@humanlayer/ui/components/CodeLayerToaster'
import { TooltipProvider } from '@humanlayer/ui/components/tooltip'
import { useIsMobile } from '@humanlayer/ui/hooks/use-mobile'
import type { QueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext, Outlet, useRouterState } from '@tanstack/react-router'
import { lazy, Suspense } from 'react'

import { CommandPalette } from '@/components/CommandPalette'
import { FakeMacTrafficLights } from '@/components/dev/FakeMacTrafficLights'
import { DynamicDocumentTitle } from '@/components/DynamicDocumentTitle'
import { Footer } from '@/components/Footer'
import {
	HorizontalTabChrome,
	HorizontalTabChromeStrip,
	useHorizontalTabChromeState,
} from '@/components/horizontal-tabs/HorizontalTabChrome'
import { HotkeyHelpModal } from '@/components/HotkeyHelpModal'
import { ProviderProvider } from '@/components/ProviderProvider'
import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { useMinimalistLayout } from '@/hooks/use-minimalist-layout'
import { useMountEffect } from '@/hooks/useMountEffect'
import { isSharedArtifactRoute } from '@/lib/auth-routing'
import { hasTauriChrome, showsFakeWindowControls } from '@/lib/tauri-chrome'
import type { PreloadService } from '@/services/preload-service'

interface MyRouterContext {
	queryClient: QueryClient
	preloadService: PreloadService | null
}

const MinimalistFrame = lazy(() => import('@/minimalist/MinimalistFrame'))

function AppFrame({ roundedCornersEnabled }: { roundedCornersEnabled: boolean }) {
	const minimalist = useMinimalistLayout()
	if (minimalist)
		return (
			<Suspense fallback={null}>
				<MinimalistFrame>
					<DynamicDocumentTitle />
					<Outlet />
				</MinimalistFrame>
			</Suspense>
		)
	return (
		<HorizontalTabChrome>
			<RootAppFrame roundedCornersEnabled={roundedCornersEnabled} />
		</HorizontalTabChrome>
	)
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
	component: function RootLayout() {
		const initializeDefaultEditorFromEnv = useSettingsStore((s) => s.initializeDefaultEditorFromEnv)
		const roundedCornersEnabled = useSettingsStore((s) => s.roundedCornersEnabled)
		const pathname = useRouterState({ select: (state) => state.location.pathname })
		const showsStandardToaster = !useMinimalistLayout() || isSharedArtifactRoute(pathname)
		useMountEffect(() => {
			void initializeDefaultEditorFromEnv()
		})

		return (
			<TooltipProvider>
				{showsStandardToaster && <CodeLayerToaster />}
				{showsFakeWindowControls() && <FakeMacTrafficLights />}
				<ProviderProvider>
					{isSharedArtifactRoute(pathname) ? (
						<Outlet />
					) : (
						<AppFrame roundedCornersEnabled={roundedCornersEnabled} />
					)}
				</ProviderProvider>
			</TooltipProvider>
		)
	},
})

function RootAppFrame({ roundedCornersEnabled }: { roundedCornersEnabled: boolean }) {
	const isMobile = useIsMobile()
	const { ownsHorizontalChrome } = useHorizontalTabChromeState()
	const shellOwnsTitlebar =
		useRouterState({
			select: (state) =>
				state.matches.some((match) => match.routeId === '/_app' || match.routeId === '/settings'),
		}) && !isMobile

	return (
		<>
			<DynamicDocumentTitle />
			<div
				className={`flex h-dvh max-h-dvh min-h-dvh flex-col overflow-hidden bg-background${roundedCornersEnabled ? ' rounded-corners' : ''}`}
			>
				<HorizontalTabChromeStrip />
				{hasTauriChrome() && !shellOwnsTitlebar && !ownsHorizontalChrome && (
					<div data-tauri-drag-region className="tauri-titlebar-drag-region" />
				)}
				<div className="flex min-h-0 flex-1 overflow-auto">
					<Outlet />
				</div>
				<CommandPalette />
				<HotkeyHelpModal />
				<Footer />
			</div>
		</>
	)
}
