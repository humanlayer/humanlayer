import { Button } from '@humanlayer/ui/components/button'
import { SyncGridAnimation } from '@humanlayer/ui/components/sync-grid-animation'
import { createFileRoute } from '@tanstack/react-router'
import { useSessionStorage } from '@uidotdev/usehooks'
import { useAuth } from '@workos-inc/authkit-react'
import { useEffect, useState } from 'react'

import { useBrowserAuth } from '@/hooks/use-browser-auth'
import { useMountEffect } from '@/hooks/useMountEffect'
import { captureException } from '@/integrations/sentry/sentry'
import { logger } from '@/lib/logger'

/**
 * Check if we're returning from a failed OAuth attempt.
 * This prevents infinite redirect loops when OAuth fails.
 */
function hasOAuthError(): boolean {
	const searchParams = new URLSearchParams(window.location.search)
	// Check for common OAuth error indicators
	return (
		searchParams.has('error') ||
		searchParams.has('error_description') ||
		// Also check if we have code/state params that might have failed processing
		(searchParams.has('code') && !searchParams.has('access_token'))
	)
}

/**
 * Get OAuth error message from URL params
 */
function getOAuthError(): string | null {
	const searchParams = new URLSearchParams(window.location.search)
	const error = searchParams.get('error')
	const errorDescription = searchParams.get('error_description')

	if (errorDescription) {
		return errorDescription
	}
	if (error) {
		return `Authentication error: ${error}`
	}
	return null
}

/**
 * Clear OAuth params from URL to prevent stale state
 */
function clearOAuthParams() {
	const url = new URL(window.location.href)
	url.searchParams.delete('code')
	url.searchParams.delete('state')
	url.searchParams.delete('error')
	url.searchParams.delete('error_description')
	window.history.replaceState({}, '', url.toString())
}

/**
 * Auto sign-in fires at most once per browsing session. A failed OAuth callback
 * lands back on this page with fresh component state, so component state alone
 * would relaunch the browser on every bounce and loop forever.
 */
const AUTO_SIGN_IN_ATTEMPTED_KEY = 'riptide:auto-sign-in-attempted'

export const Route = createFileRoute('/_app/auth/signin')({
	validateSearch: (
		search,
	): {
		context?: string
		organizationId?: string
	} => ({
		context: typeof search.context === 'string' ? search.context : undefined,
		organizationId: typeof search.organizationId === 'string' ? search.organizationId : undefined,
	}),
	component: SigninPage,
})

function SigninPage() {
	const { signIn, shouldUseSystemBrowser } = useBrowserAuth()
	const { isLoading } = useAuth()
	const signinSearch = Route.useSearch()
	const [isRedirecting, setIsRedirecting] = useState(false)
	const [error, setError] = useState<string | null>(() => {
		return getOAuthError() ?? (hasOAuthError() ? 'Authentication failed. Please try signing in again.' : null)
	})
	const [hasAttemptedAutoSignIn, setHasAttemptedAutoSignIn] = useSessionStorage<boolean | number | undefined>(
		AUTO_SIGN_IN_ATTEMPTED_KEY,
		undefined,
	)
	useMountEffect(() => {
		// Clear stale OAuth params from the URL on mount if there was an error
		if (error) {
			clearOAuthParams()
		}
	})

	useEffect(() => {
		// Don't auto-redirect if we're already redirecting
		if (isRedirecting || isLoading) return

		// Don't auto-redirect if we've already tried once this session
		if (hasAttemptedAutoSignIn) return

		// Don't auto-redirect if there's an error
		if (error) return

		// Mark that we've attempted auto sign-in
		setHasAttemptedAutoSignIn(true)

		const { context, organizationId } = signinSearch

		setIsRedirecting(true)

		logger.info('[Signin] Signing in...', { context, organizationId })
		signIn({ context, organizationId }).catch((err) => {
			logger.error('[Signin] Failed to sign in:', err)
			captureException(err instanceof Error ? err : new Error(String(err)), {
				tags: { action: 'signIn' },
			})
			setError('Failed to open sign-in. Please try again.')
			setIsRedirecting(false)
		})
	}, [signIn, isRedirecting, hasAttemptedAutoSignIn, setHasAttemptedAutoSignIn, error, isLoading, signinSearch])

	const handleTryAgain = () => {
		setError(null)
		clearOAuthParams()

		const { context, organizationId } = signinSearch

		setIsRedirecting(true)

		logger.info('[Signin] Retrying sign in', { context, organizationId })
		signIn({ context, organizationId }).catch((err) => {
			logger.error('[Signin] Failed to sign in:', err)
			captureException(err instanceof Error ? err : new Error(String(err)), {
				tags: { action: 'signIn' },
			})
			setError('Failed to open sign-in. Please try again.')
			setIsRedirecting(false)
		})
	}

	return (
		<div className="flex h-screen items-center justify-center bg-background">
			<div className="text-center max-w-md px-4">
				{error ? (
					<div className="space-y-4">
						<p className="text-destructive">{error}</p>
						<Button variant="secondary" onClick={handleTryAgain}>
							Try again
						</Button>
					</div>
				) : (
					<>
						<SyncGridAnimation variant="snake" speed={120} className="mx-auto w-8 text-primary" />
						<p className="mt-4 text-muted-foreground">
							{shouldUseSystemBrowser
								? 'Opening browser for sign in...'
								: 'Redirecting to sign in...'}{' '}
						</p>
						<Button variant="secondary" className="mt-4" type="button" onClick={handleTryAgain}>
							Try again
						</Button>
					</>
				)}
			</div>
		</div>
	)
}
