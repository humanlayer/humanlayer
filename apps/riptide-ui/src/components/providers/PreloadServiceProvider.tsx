import { useRouter } from '@tanstack/react-router'
import { useAuth } from '@workos-inc/authkit-react'
import { type ReactNode, useEffect } from 'react'

import { createPreloadService } from '@/services/preload-service'

/**
 * Provider that creates the preload service when auth is available and
 * registers it in the router context.
 *
 * Must be rendered inside AuthProvider (for useAuth) and inside RouterProvider
 * (for useRouter).
 */
export function PreloadServiceProvider({ children }: { children: ReactNode }) {
	const router = useRouter()
	const { user, organizationId, getAccessToken } = useAuth()

	useEffect(() => {
		if (!user?.id || !organizationId) {
			// Clear preload service when not authenticated
			router.update({ context: { ...router.options.context, preloadService: null } })
			return
		}

		// Create preload service with current auth context
		const preloadService = createPreloadService({
			userId: user.id,
			organizationId,
			tokenFetcher: getAccessToken,
		})

		// Register in router context
		router.update({ context: { ...router.options.context, preloadService } })
	}, [user?.id, organizationId, getAccessToken, router])

	return children
}
