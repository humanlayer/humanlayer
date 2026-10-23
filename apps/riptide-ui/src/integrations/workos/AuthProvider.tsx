import { SyncGridAnimation } from '@humanlayer/ui/components/sync-grid-animation'
import * as Sentry from '@sentry/react'
import { useQuery } from '@tanstack/react-query'
import { useLocation, useNavigate } from '@tanstack/react-router'
import { AuthKitProvider, useAuth } from '@workos-inc/authkit-react'
import { type FC, type PropsWithChildren, useEffect, useMemo } from 'react'
import { toast } from 'sonner'

import { setElectronSentryIdentity } from '@/integrations/electron/sentry-identity'
import { isPublicBrowserRoute, isSharedArtifactRoute } from '@/lib/auth-routing'
import { logger } from '@/lib/logger'
import { isElectron, isTauri } from '@/lib/utils'
import { useRiptideApi } from '@/orpc/client'
import { captureAuthReturnToState, consumeAuthReturnTo, storeAuthReturnTo } from '@/utils/auth-route-state'

// Inner component that handles auth enforcement for Pro builds
function AuthEnforcer({ children }: PropsWithChildren) {
	const { isLoading, user, organizationId, role, roles, featureFlags } = useAuth()

	const location = useLocation()
	const isSharedRoute = isSharedArtifactRoute(location.pathname)
	const isPublicRoute = isPublicBrowserRoute(location.pathname)
	const navigate = useNavigate()
	const { queryClient } = useRiptideApi()

	// Fetch organizations to get the active organization name
	const { data: organizationsData } = useQuery(
		queryClient.auth.user.organizations.list.queryOptions({
			enabled: !!user && !!organizationId,
			staleTime: 30_000,
		}),
	)

	const activeOrganization = organizationsData?.organizations?.find((org) => org.organizationId === organizationId)

	useEffect(() => {
		if (user) {
			try {
				// Note: These fields are subject to allowlist filtering in scrubSensitiveData()
				// See: src/integrations/sentry/sentry.ts - only id, email, organizationId,
				// organizationName, role, roles, and featureFlags are preserved
				Sentry.setUser({
					id: user.id,
					email: user.email,
					organizationId,
					organizationName: activeOrganization?.organizationName,
					roles: roles,
					role: role,
					featureFlags: featureFlags,
				})

				Sentry.setContext(
					'organization',
					organizationId ? { id: organizationId, name: activeOrganization?.organizationName } : null,
				)
				if (isElectron()) {
					void setElectronSentryIdentity({
						userId: user.id,
						email: user.email,
						organizationId: organizationId ?? undefined,
						organizationName: activeOrganization?.organizationName,
					}).catch((error) => logger.error('Unable to update Electron main Sentry identity', error))
				}
				logger.info('Sentry user context updated')
			} catch (error: unknown) {
				logger.error('Unable to update sentry user info:', error)
			}
		}

		// wait for loading to finish before redirecting to signin
		if (isLoading) {
			logger.debug('waiting for loading to finish')
			return
		}

		if (!user && isElectron()) {
			Sentry.setUser(null)
			Sentry.setContext('organization', null)
			void setElectronSentryIdentity({ userId: null }).catch((error) =>
				logger.error('Unable to clear Electron main Sentry identity', error),
			)
		}

		// allow auth page without auth
		if (isPublicRoute) {
			return
		}

		// Don't redirect if we have OAuth params in the URL - AuthKit is processing them
		// This prevents redirect loops when OAuth callback is being processed
		const searchParams = new URLSearchParams(window.location.search)
		if (searchParams.has('code') || searchParams.has('state') || searchParams.has('error')) {
			return
		}

		// Redirect to login if not authenticated
		if (!user) {
			const returnState = captureAuthReturnToState(location.pathname, location.search)
			storeAuthReturnTo(returnState)
			logger.info('[AuthProvider] Loading finished, user not found, redirecting to sign in', { returnState })

			navigate({
				to: '/auth/signin',
				search: {
					context: undefined,
					organizationId: undefined,
				},
			})
			return
		}

		// Redirect to organization selection if no org selected
		if (!organizationId && !location.pathname.includes('auth/organizations')) {
			logger.debug('navigating to organization selection')
			navigate({ to: '/auth/organizations/select' })
			return
		}
	}, [
		user,
		isLoading,
		organizationId,
		activeOrganization,
		role,
		roles,
		featureFlags,
		location.pathname,
		location.search,
		navigate,
		isPublicRoute,
	])

	// Persist the selected organization to localStorage for future sessions
	useEffect(() => {
		if (organizationId) {
			localStorage.setItem('lastSelectedOrganization', organizationId)
		}
	}, [organizationId])

	// Nothing auth-dependent may render before auth resolves. Electric marks a shape
	// "ready" on *any* error, including the AccessTokenUnavailableError the token
	// fetcher throws while auth is still loading, so a collection created without a
	// token reports isReady with zero rows. Pages that branch on that then claim the
	// row does not exist: opening a session deep link cold showed "Session Not Found"
	// before the sign-in redirect had even started. Routes that must render without a
	// resolved session are excluded.
	const isAuthRoute = location.pathname === '/auth/signin' || location.pathname === '/auth/signout'
	const isOrganizationRoute = location.pathname.includes('auth/organizations')
	const oauthParams = new URLSearchParams(window.location.search)
	const isProcessingOAuthCallback = oauthParams.has('code') || oauthParams.has('state') || oauthParams.has('error')
	const isAuthResolved = !isLoading && !!user && !!organizationId
	if (!isAuthResolved && !isAuthRoute && !isOrganizationRoute && !isProcessingOAuthCallback && !isSharedRoute) {
		return <AuthBootScreen />
	}

	return children
}

/**
 * Neutral boot state held until auth resolves. It deliberately matches the sync
 * placeholder the detail pages render, so a cold deep link reads as one continuous
 * load instead of a sequence of contradictory screens.
 */
function AuthBootScreen() {
	return (
		<div className="flex h-full w-full flex-1 items-center justify-center bg-background">
			<SyncGridAnimation variant="snake" size="lg" speed={120} className="text-accent" />
		</div>
	)
}

export const AuthProvider: FC<PropsWithChildren<{}>> = ({ children }) => {
	const navigate = useNavigate()

	const redirectUri = useMemo(() => {
		// In Tauri Pro builds, use the deep link callback URL
		// This allows us to open auth in system browser
		if ((isTauri() || isElectron()) && !import.meta.env.DEV) {
			return `${import.meta.env.VITE_PUBLIC_DEEP_LINK_SCHEME || 'riptide'}://oauth/callback`
		}
		// For web or non-Pro builds, use the window origin
		return window ? `${window.location.origin}` : undefined
	}, [])

	return (
		<AuthKitProvider
			clientId={import.meta.env.VITE_PUBLIC_WORKOS_CLIENT_ID}
			redirectUri={redirectUri}
			// TODO: set devMode back to `import.meta.env.DEV` once we have a WorkOS custom domain set up
			devMode={true}
			onRedirectCallback={({ user }) => {
				logger.info('Auth callback - user:', user)
				toast.success(`Welcome${user.firstName ? `, ${user.firstName}` : '!'}`)

				const returnTo = consumeAuthReturnTo()
				// Deferred: onRedirectCallback fires during AuthKitProvider's render,
				// so a synchronous navigate() gets swallowed by React's batching.
				setTimeout(() => {
					if (returnTo) {
						logger.info('[AuthProvider] Restoring stored return route after auth callback', { returnTo })
						navigate({
							to: returnTo.pathname,
							search: returnTo.search,
							replace: true,
						} as never)
						return
					}
					navigate({ to: '/', replace: true })
				}, 0)
			}}
			onRefreshFailure={(error) => {
				toast.error('Session expired. Please sign in again.')
				console.error('refresh failed:', error)
				// Navigate to sign-in page - it will handle browser auth for Tauri Pro
				setTimeout(() => {
					navigate({ to: '/auth/signin' })
				}, 2000)
			}}
		>
			<AuthEnforcer>{children}</AuthEnforcer>
		</AuthKitProvider>
	)
}
