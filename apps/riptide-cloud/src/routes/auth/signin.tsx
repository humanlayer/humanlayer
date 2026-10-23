import { Button } from '@humanlayer/ui/components/button'
import { SyncGridAnimation } from '@humanlayer/ui/components/sync-grid-animation'
import { createFileRoute } from '@tanstack/react-router'
import { useAuth } from '@workos-inc/authkit-react'
import { useRef, useState } from 'react'

import { useMountEffect } from '@/hooks/useMountEffect'
import { captureException } from '@/integrations/sentry/sentry'
import { captureAuthReturnToHref, storeAuthReturnTo } from '@/utils/auth-route-state'

export const Route = createFileRoute('/auth/signin')({
	component: SigninPage,
})

function SigninPage() {
	const { signIn, isLoading } = useAuth()
	const [error, setError] = useState<string | null>(null)

	if (isLoading) {
		return <SigninStatus />
	}

	return <SigninReady signIn={signIn} error={error} setError={setError} />
}

function SigninReady({
	signIn,
	error,
	setError,
}: {
	signIn: ReturnType<typeof useAuth>['signIn']
	error: string | null
	setError: (error: string | null) => void
}) {
	const attempted = useRef(false)

	useMountEffect(() => {
		if (attempted.current) return
		attempted.current = true

		// Check for OAuth errors
		const searchParams = new URLSearchParams(window.location.search)
		if (searchParams.has('error')) {
			setError(searchParams.get('error_description') || 'Authentication failed')
			return
		}

		// Don't auto-redirect if we have code/state params being processed
		if (searchParams.has('code') || searchParams.has('state')) {
			return
		}

		const organizationId = searchParams.get('organizationId') ?? undefined
		const returnTo = searchParams.get('returnTo')
		if (returnTo) storeAuthReturnTo(captureAuthReturnToHref(returnTo))
		signIn({ organizationId }).catch((err) => {
			console.error('Sign in failed:', err)
			captureException(err instanceof Error ? err : new Error('Sign in failed'), {
				action: 'signIn',
			})
			setError('Failed to sign in. Please try again.')
		})
	})

	const handleRetry = () => {
		setError(null)
		const searchParams = new URLSearchParams(window.location.search)
		const returnTo = searchParams.get('returnTo')
		const organizationId = searchParams.get('organizationId') ?? undefined
		if (returnTo) storeAuthReturnTo(captureAuthReturnToHref(returnTo))
		signIn({ organizationId }).catch((err) => {
			console.error('Sign in failed:', err)
			captureException(err instanceof Error ? err : new Error('Sign in failed'), {
				action: 'signIn',
			})
			setError('Failed to sign in. Please try again.')
		})
	}

	return (
		<div className="flex h-screen items-center justify-center">
			<div className="text-center max-w-md px-4 space-y-4">
				{error ? (
					<>
						<p className="text-destructive">{error}</p>
						<Button variant="secondary" onClick={handleRetry}>
							Try again
						</Button>
					</>
				) : (
					<>
						<SyncGridAnimation variant="snake" speed={120} className="mx-auto w-8 text-primary" />
						<p className="text-muted-foreground">Redirecting to sign in...</p>
					</>
				)}
			</div>
		</div>
	)
}

function SigninStatus() {
	return (
		<div className="flex h-screen items-center justify-center">
			<div className="text-center max-w-md px-4 space-y-4">
				<SyncGridAnimation variant="snake" speed={120} className="mx-auto w-8 text-primary" />
				<p className="text-muted-foreground">Redirecting to sign in...</p>
			</div>
		</div>
	)
}
