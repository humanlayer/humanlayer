import { Button } from '@humanlayer/ui/components/button'
import * as Sentry from '@sentry/react'
import type { ErrorComponentProps } from '@tanstack/react-router'
import { AlertCircle, RefreshCw } from 'lucide-react'

import { useMountEffect } from '@/hooks/useMountEffect'

/**
 * Error component for TanStack Router's defaultErrorComponent.
 * Pattern from: apps/riptide-ui/src/integrations/sentry/RouterErrorComponent.tsx:13-47
 */
export function RouterErrorComponent({ error, info, reset }: ErrorComponentProps) {
	// error and info are stable for the lifetime of this component instance —
	// the router remounts this component for each new error, so we only need
	// to report once on mount rather than re-reporting on every re-render.
	useMountEffect(() => {
		console.error('Router Error Boundary caught error:', error, info)

		// Report to Sentry with component stack context
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
	})

	return (
		<div className="flex flex-col items-center justify-center min-h-[50vh] p-8 text-center">
			<AlertCircle className="w-16 h-16 text-red-500 mb-4" />
			<h1 className="text-2xl font-bold mb-2">Something went wrong</h1>
			<p className="text-muted-foreground mb-6 max-w-md">
				An unexpected error occurred. The error has been reported and we'll investigate the issue.
			</p>
			<Button onClick={reset} className="gap-2">
				<RefreshCw className="w-4 h-4" />
				Try Again
			</Button>
		</div>
	)
}
