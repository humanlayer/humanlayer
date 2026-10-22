import { Button } from '@humanlayer/ui/components/button'
import * as Sentry from '@sentry/react'
import { AlertCircle, RefreshCw } from 'lucide-react'
import React from 'react'

interface Props {
	children: React.ReactNode
	fallback?: React.ComponentType<{ error: Error; resetError: () => void }>
	componentName?: string
}

interface State {
	hasError: boolean
	error?: Error
}

class SentryErrorBoundaryCore extends React.Component<Props, State> {
	constructor(props: Props) {
		super(props)
		this.state = { hasError: false }
	}

	static getDerivedStateFromError(error: Error): State {
		return { hasError: true, error }
	}

	componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
		const componentName = this.props.componentName || 'Unknown'

		console.error('React Error Boundary caught error:', error, errorInfo)

		// Report to Sentry — pattern from SentryErrorBoundary.tsx:45-57
		// IMPORTANT: Never include component props or state, only the error stack
		Sentry.captureException(error, {
			contexts: {
				react: {
					componentStack: errorInfo.componentStack,
					// DO NOT include props or state
				},
			},
			tags: {
				errorBoundary: true,
				componentName,
			},
		})
	}

	handleReset = () => {
		this.setState({ hasError: false, error: undefined })
	}

	render() {
		if (this.state.hasError) {
			const error = this.state.error
			if (this.props.fallback && error) {
				const Fallback = this.props.fallback
				return <Fallback error={error} resetError={this.handleReset} />
			}

			return (
				<div className="flex flex-col items-center justify-center min-h-[50vh] p-8 text-center">
					<AlertCircle className="w-16 h-16 text-red-500 mb-4" />
					<h1 className="text-2xl font-bold mb-2">Something went wrong</h1>
					<p className="text-muted-foreground mb-6 max-w-md">
						An unexpected error occurred. The error has been reported and we'll investigate the issue.
					</p>
					<Button onClick={this.handleReset} className="gap-2">
						<RefreshCw className="w-4 h-4" />
						Try Again
					</Button>
				</div>
			)
		}

		return this.props.children
	}
}

// Export wrapped with Sentry integration — pattern from SentryErrorBoundary.tsx:193
export const SentryErrorBoundary = Sentry.withErrorBoundary(SentryErrorBoundaryCore, {
	showDialog: false, // We handle UI ourselves
})
