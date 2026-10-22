import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRouter, RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import ReactDOM from 'react-dom/client'

import { RouterErrorComponent } from '@/integrations/sentry/RouterErrorComponent'
import { initializeSentry } from '@/integrations/sentry/sentry'

import { routeTree } from './routeTree.gen'

import './styles.css'

const devstackId = import.meta.env.VITE_PUBLIC_DEVSTACK_ID
if (devstackId) {
	document.title = devstackId
	const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
	const devstackColor = `#${import.meta.env.VITE_PUBLIC_DEVSTACK_COLOR}`
	if (favicon && /^#[\da-f]{6}$/i.test(devstackColor)) {
		favicon.href = `data:image/svg+xml,${encodeURIComponent(
			`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${devstackColor}"/><path d="M20 44a10 10 0 0 1-1-20 15 15 0 0 1 28 6 7 7 0 0 1-2 14Z" fill="#1b1e28"/></svg>`,
		)}`
	}
}

// Create query client
const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			staleTime: 30_000,
			retry: 1,
		},
	},
})

// Create router
const router = createRouter({
	routeTree,
	context: { queryClient },
	defaultPreload: 'intent',
	scrollRestoration: true,
	defaultStructuralSharing: true,
	defaultPreloadStaleTime: 0,
	defaultErrorComponent: RouterErrorComponent,
})

// Initialize Sentry with TanStack Router integration
initializeSentry(router)

// Register router for type safety
declare module '@tanstack/react-router' {
	interface Register {
		router: typeof router
	}
}

// Render
const rootElement = document.getElementById('app')
if (rootElement && !rootElement.innerHTML) {
	const root = ReactDOM.createRoot(rootElement)
	root.render(
		<StrictMode>
			<QueryClientProvider client={queryClient}>
				<RouterProvider router={router} />
			</QueryClientProvider>
		</StrictMode>,
	)
}
