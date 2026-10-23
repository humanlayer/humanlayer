import * as Sentry from '@sentry/react'
import { useLocation, useNavigate } from '@tanstack/react-router'
import { AuthKitProvider, useAuth } from '@workos-inc/authkit-react'
import type { FC, PropsWithChildren } from 'react'
import { useEffect } from 'react'
import { toast } from 'sonner'

import { env } from '@/env'
import { isPublicRoute } from '@/lib/auth-routing'
import { captureAuthReturnToState, consumeAuthReturnTo, storeAuthReturnTo } from '@/utils/auth-route-state'
import { logger } from '@/utils/logger'

/**
 * AuthEnforcer handles redirect logic for unauthenticated users.
 * Simplified from riptide-ui - no Tauri/system browser complexity.
 */
function AuthEnforcer({ children }: PropsWithChildren) {
	const { isLoading, user, organizationId, role, roles } = useAuth()
	const navigate = useNavigate()
	const { pathname, search, hash } = useLocation()

	// Set Sentry user context — pattern from AuthProvider.tsx:59-72
	// Also persists selected organization to localStorage
	useEffect(() => {
		if (user && organizationId) {
			// Note: Fields subject to allowlist filtering in scrubSensitiveData()
			Sentry.setUser({
				id: user.id,
				email: user.email,
				organizationId: organizationId,
				role: role,
				roles: roles,
			})
			Sentry.setContext('organization', {
				id: organizationId,
			})
			localStorage.setItem('lastSelectedOrganization', organizationId)
		} else if (!user) {
			Sentry.setUser(null)
		}
	}, [user, organizationId, role, roles])

	useEffect(() => {
		if (isLoading) return

		if (isPublicRoute(pathname)) return

		// Don't redirect during OAuth callback processing
		const searchParams = new URLSearchParams(window.location.search)
		if (searchParams.has('code') || searchParams.has('state') || searchParams.has('error')) {
			return
		}

		if (!user) {
			const returnTo = captureAuthReturnToState(pathname, search, hash)
			storeAuthReturnTo(returnTo)
			navigate({
				to: '/auth/signin',
			})
			return
		}

		if (!organizationId && !pathname.includes('organizations')) {
			navigate({ to: '/organizations/select' })
			return
		}
	}, [isLoading, user, organizationId, pathname, search, hash, navigate])

	return <>{children}</>
}

export const AuthProvider: FC<PropsWithChildren> = ({ children }) => {
	const navigate = useNavigate()

	return (
		<AuthKitProvider
			clientId={env.VITE_PUBLIC_WORKOS_CLIENT_ID}
			redirectUri={`${window.location.origin}/auth/callback`}
			// TODO: set devMode back to `import.meta.env.DEV` once we have a WorkOS custom domain set up
			devMode={true}
			onRedirectCallback={({ user, organizationId }) => {
				toast.success(`Welcome${user.firstName ? `, ${user.firstName}` : '!'}`)

				if (!organizationId) {
					setTimeout(() => navigate({ to: '/organizations/select', replace: true }), 0)
					return
				}

				const returnTo = consumeAuthReturnTo()
				logger.info('[AuthProvider] Restoring stored return route after auth callback', { returnTo })
				setTimeout(() => {
					if (returnTo) {
						navigate({
							to: returnTo.pathname,
							search: returnTo.search,
							hash: returnTo.hash,
							replace: true,
						} as never)
						return
					}

					navigate({ to: '/artifacts', replace: true })
				}, 0)
			}}
			onRefreshFailure={(error) => {
				console.error('Auth refresh failed:', error)
				// Refresh failing is expected auth-lifecycle churn (expired/rotated session); toast + redirect,
				// but do not report to Sentry. Mirrors riptide-ui, whose onRefreshFailure also only toasts + redirects.
				toast.error('Session expired. Please sign in again.')
				setTimeout(() => navigate({ to: '/auth/signin' }), 2000)
			}}
		>
			<AuthEnforcer>{children}</AuthEnforcer>
		</AuthKitProvider>
	)
}
