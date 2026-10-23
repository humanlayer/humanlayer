import { ThemeProvider } from '@humanlayer/ui/components/theme-provider'
import { TooltipProvider } from '@humanlayer/ui/components/tooltip'
import type { Preview } from '@storybook/react-vite'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterContextProvider,
} from '@tanstack/react-router'
import { AuthKitProvider } from '@workos-inc/authkit-react'
import { useEffect } from 'react'

import '../src/styles.css'

// Minimal stub router so production components that render <Link> from
// @tanstack/react-router (e.g. SessionTableRow) have a routing context in
// Storybook. Without this, useLinkProps crashes on `router.isServer`.
const rootRoute = createRootRoute({ component: () => <Outlet /> })
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: () => null })
const sessionRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/sessions/$sessionId',
	component: () => null,
})
const sessionDraftRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/sessions/draft',
	component: () => null,
})
const tasksRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/tasks/$taskId',
	component: () => null,
})
const storybookRouter = createRouter({
	routeTree: rootRoute.addChildren([indexRoute, sessionRoute, sessionDraftRoute, tasksRoute]),
	history: createMemoryHistory({ initialEntries: ['/'] }),
})

// Storybook-only QueryClient so components calling useQuery don't crash.
const storybookQueryClient = new QueryClient({
	defaultOptions: { queries: { retry: false, staleTime: Infinity } },
})

// Define available themes
const themes = [
	{ value: 'poimandres-vscode', title: '🌌 Poimandres' },
	{ value: 'sentry', title: '🔭 Sentry' },
	{ value: 'framer-dark', title: '🎨 Framer Dark' },
	{ value: 'framer-light', title: '🎨 Framer Light' },
	{ value: 'catppuccin', title: '🐱 Catppuccin' },
	{ value: 'solarized-dark', title: '🌙 Solarized Dark' },
	{ value: 'gruvbox-dark', title: '🌲 Gruvbox Dark' },
	{ value: 'monokai', title: '🎯 Monokai' },
	{ value: 'rose-pine', title: '🌹 Rosé Pine' },
	{ value: 'nord-vscode', title: '❄️ Nord' },
]

const preview: Preview = {
	parameters: {
		controls: {
			matchers: {
				color: /(background|color)$/i,
				date: /Date$/i,
			},
		},
		backgrounds: {
			default: 'dark',
			values: [
				{ name: 'dark', value: '#181818' },
				{ name: 'light', value: '#ffffff' },
			],
		},
	},
	globalTypes: {
		theme: {
			name: 'Terminal Theme',
			description: 'CodeLayer terminal theme',
			defaultValue: 'poimandres-vscode',
			toolbar: {
				icon: 'paintbrush',
				items: themes,
				showName: true,
				dynamicTitle: true,
			},
		},
	},
	decorators: [
		(Story, context) => {
			const theme = context.globals.theme || 'poimandres-vscode'

			useEffect(() => {
				document.documentElement.setAttribute('data-theme', theme)
				document.body.classList.add('bg-background', 'text-foreground')
				const computedStyle = getComputedStyle(document.documentElement)
				const backgroundColor = computedStyle.getPropertyValue('--terminal-bg').trim()
				if (backgroundColor) {
					document.body.style.backgroundColor = backgroundColor
				}
			}, [theme])

			const isLayoutCentered = context.parameters?.layout === 'centered'
			const isLayoutPadded = context.parameters?.layout === 'padded'

			return (
				<ThemeProvider key={theme} defaultTheme={theme} storageKey={`storybook-theme-${theme}`}>
					<RouterContextProvider router={storybookRouter}>
						<QueryClientProvider client={storybookQueryClient}>
							<AuthKitProvider
								clientId={import.meta.env.VITE_PUBLIC_WORKOS_CLIENT_ID ?? 'storybook-client-id'}
								devMode={true}
							>
								<TooltipProvider>
									<div
										className={`bg-background text-foreground font-mono ${
											isLayoutCentered
												? 'flex items-center justify-center p-8'
												: isLayoutPadded
													? 'p-8'
													: 'min-h-screen'
										}`}
									>
										<Story />
									</div>
								</TooltipProvider>
							</AuthKitProvider>
						</QueryClientProvider>
					</RouterContextProvider>
				</ThemeProvider>
			)
		},
	],
}

export default preview
