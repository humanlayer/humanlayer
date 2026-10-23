import { captureException } from '@/integrations/sentry/sentry'
import { logger } from '@/lib/logger'

type NavigateToDeepLink = (options: { href: string }) => void
type OpenNavigationDeepLink = (href: string) => void

export const getDeepLinkScheme = () => import.meta.env.VITE_PUBLIC_DEEP_LINK_SCHEME ?? 'humanlayer'

export function buildNavigationDeepLink(destination: string, search = ''): string {
	return `${getDeepLinkScheme()}://nav/${destination.replace(/^\//, '')}${search ? `?${search}` : ''}`
}

function navigationHrefFromUrl(url: URL): string {
	url.searchParams.delete('deep')
	const path = url.pathname.startsWith('/') ? url.pathname : `/${url.pathname}`
	return `${path || '/'}${url.search}${url.hash}`
}

export function parseNavigationDeepLink(urlString: string): string | null {
	const url = new URL(urlString)
	return url.host === 'nav' ? navigationHrefFromUrl(url) : null
}

export function handleDeepLinkUrl(
	urlString: string,
	navigate: NavigateToDeepLink,
	openNavigationDeepLink?: OpenNavigationDeepLink,
) {
	logger.info('[DeepLink] Received:', urlString)
	try {
		const url = new URL(urlString)
		if (url.host === 'oauth' && url.pathname === '/callback') {
			if (url.searchParams.has('code')) window.location.href = `/callback?${url.searchParams.toString()}`
			return
		}
		if (url.host === 'focus') return
		if (url.host === 'nav') {
			const href = navigationHrefFromUrl(url)
			if (openNavigationDeepLink) openNavigationDeepLink(href)
			else navigate({ href })
			return
		}
		logger.warn('[DeepLink] Unknown deep link host:', url.host)
	} catch (error) {
		logger.error('[DeepLink] Failed to parse URL:', error)
		captureException(error instanceof Error ? error : new Error(String(error)), {
			tags: { action: 'parseDeepLink' },
		})
	}
}
