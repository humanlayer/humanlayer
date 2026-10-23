import { useNavigate } from '@tanstack/react-router'

import { handleDeepLinkUrl } from '@/domains/deep-links/handler'
import { useMountEffect } from '@/hooks/useMountEffect'
import { onDeepLink, takePendingDeepLink } from '@/integrations/desktop/deep-links'
import { captureException } from '@/integrations/sentry/sentry'
import { logger } from '@/lib/logger'

import { useHorizontalTabs } from './horizontal-tabs/HorizontalTabsProvider'

/**
 * Self-contained component that handles desktop deep links.
 * Renders nothing - just sets up the deep link listener.
 */
export function DeepLinkHandler() {
	const navigate = useNavigate()
	const { isAvailable: areHorizontalTabsAvailable, openIncomingDestination } = useHorizontalTabs()
	const handleLink = (url: string) => {
		handleDeepLinkUrl(
			url,
			({ href }) => void navigate({ href }),
			areHorizontalTabsAvailable ? openIncomingDestination : undefined,
		)
	}

	useMountEffect(() => {
		let disposed = false
		let removeListener: (() => void) | null = null
		const removeDeepLinkListener = () => {
			const listener = removeListener
			removeListener = null
			listener?.()
		}
		void onDeepLink((link) => {
			if (!disposed) handleLink(link.url)
		})
			.then((unlisten) => {
				if (unlisten === null) return
				if (disposed) unlisten()
				else removeListener = unlisten
			})
			.catch((error: unknown) => {
				logger.error('[DeepLink] Failed to drain pending deep link:', error)
				captureException(error instanceof Error ? error : new Error(String(error)), {
					tags: { action: 'takePendingDeepLink' },
				})
			})
		const drainPendingLinks = async () => {
			while (!disposed) {
				const link = await takePendingDeepLink()
				if (link === null) return
				handleLink(link.url)
			}
		}
		void drainPendingLinks().catch((error: unknown) => {
			logger.error('[DeepLink] Failed to drain pending deep link:', error)
			captureException(error instanceof Error ? error : new Error(String(error)), {
				tags: { action: 'takePendingDeepLink' },
			})
		})

		// Cleanup listener on unmount
		return () => {
			disposed = true
			removeDeepLinkListener()
		}
	})

	return null
}
