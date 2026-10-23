import { HotkeysProvider } from '@humanlayer/react-hotkeys-hook'
import { CodeLayerToaster } from '@humanlayer/ui/components/CodeLayerToaster'
import { SidebarProvider } from '@humanlayer/ui/components/sidebar'
import { type Theme, ThemeProvider } from '@humanlayer/ui/components/theme-provider'
import { TooltipProvider } from '@humanlayer/ui/components/tooltip'
import type { QueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext, Outlet, useRouterState } from '@tanstack/react-router'
import { useLocalStorage } from '@uidotdev/usehooks'
import { useAuth } from '@workos-inc/authkit-react'

import { AppSidebar } from '@/components/AppSidebar'
import { BillingBannerRail } from '@/components/BillingBannerRail'
import { DynamicDocumentTitle } from '@/components/DynamicDocumentTitle'
import { FocusSourceHandler } from '@/components/FocusSourceHandler'
import { Footer } from '@/components/Footer'
import { Header } from '@/components/Header'
import { FullScreenShell, LoadingShell } from '@/components/LoadingShell'
import { isPublicRoute } from '@/lib/auth-routing'
import { AuthProvider } from '@/providers/AuthProvider'
import { ElectricPreloadingProvider } from '@/providers/ElectricPreloadingProvider'
import { SyncProvider } from '@/providers/SyncProvider'

interface RouterContext {
	queryClient: QueryClient
}

export const Route = createRootRouteWithContext<RouterContext>()({
	component: RootLayout,
})

const THEME_STORAGE_KEY = 'codelayer-cloud-theme'
const DEFAULT_THEME: Theme = 'poimandres-vscode'

function RootLayout() {
	// Use selector to avoid re-rendering on every router state change
	const pathname = useRouterState({ select: (s) => s.location.pathname })
	const [theme] = useLocalStorage<Theme>(THEME_STORAGE_KEY, DEFAULT_THEME)

	return (
		<ThemeProvider defaultTheme={theme} storageKey={THEME_STORAGE_KEY}>
			<HotkeysProvider initiallyActiveScopes={['*', '.']}>
				<FocusSourceHandler />
				<AuthProvider>
					<TooltipProvider>
						<AppFrame pathname={pathname} />
					</TooltipProvider>
				</AuthProvider>
			</HotkeysProvider>
		</ThemeProvider>
	)
}

function AppFrame({ pathname }: { pathname: string }) {
	const { isLoading, user } = useAuth()
	const isOrganizationRoute = pathname.startsWith('/organizations/')
	const isFullScreenRoute = isPublicRoute(pathname) || isOrganizationRoute

	if (isLoading) {
		return <LoadingShell />
	}

	if (!user) {
		if (!isFullScreenRoute) return <LoadingShell />
		return (
			<FullScreenShell>
				<Outlet />
			</FullScreenShell>
		)
	}

	if (isFullScreenRoute) {
		return (
			<FullScreenShell>
				<Outlet />
			</FullScreenShell>
		)
	}

	return (
		<SyncProvider>
			<ElectricPreloadingProvider>
				<DynamicDocumentTitle />
				<CodeLayerToaster />
				<SidebarProvider>
					<div className="flex flex-row w-full min-h-dvh h-dvh max-h-dvh bg-background text-foreground">
						<AppSidebar />
						<div className="flex flex-col grow max-w-full min-w-0 overflow-x-clip">
							<Header />
							<BillingBannerRail />
							<main className="flex-1 overflow-auto">
								<Outlet />
							</main>
							<Footer />
						</div>
					</div>
				</SidebarProvider>
			</ElectricPreloadingProvider>
		</SyncProvider>
	)
}
