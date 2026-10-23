import { Button } from '@humanlayer/ui/components/button'
import * as Sentry from '@sentry/react'
import type { ErrorComponentProps } from '@tanstack/react-router'
import { AlertCircle, RefreshCw } from 'lucide-react'
import { useEffect } from 'react'

import { ErrorDetails } from '@/components/ErrorDetails'
import { logger } from '@/lib/logger'

/**
 * Error component for TanStack Router's defaultErrorComponent.
 * Receives { error, info, reset } props from the router.
 */
export function RouterErrorComponent({ error, info, reset }: ErrorComponentProps) {
	useEffect(() => {
		// Log the error
		logger.error('Router Error Boundary caught error:', error, info)

		// Report to Sentry
		Sentry.captureException(error, {
			contexts: {
				react: {
					componentStack: info?.componentStack,
				},
			},
			tags: {
				errorBoundary: true,
				errorBoundaryType: 'router',
			},
		})
	}, [error, info])

	return (
		<div className="flex flex-col items-center justify-center min-h-[50vh] p-8 text-center">
			<AlertCircle className="w-16 h-16 text-red-500 mb-4" />
			<h1 className="text-2xl font-bold mb-2">Something went wrong</h1>
			<p className="text-muted-foreground mb-6 max-w-md">
				An unexpected error occurred. The error has been reported and we&apos;ll investigate the issue.
			</p>
			<Button onClick={reset} className="gap-2">
				<RefreshCw className="w-4 h-4" />
				Try Again
			</Button>

			<ErrorDetails error={error} componentStack={info?.componentStack} />
		</div>
	)
}
