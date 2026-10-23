import { Button } from '@humanlayer/ui/components//button'
import * as Sentry from '@sentry/react'
import { AlertCircle, RefreshCw } from 'lucide-react'
import React from 'react'

import { ErrorDetails } from '@/components/ErrorDetails'
import { logger } from '@/lib/logger'

interface Props {
	children: React.ReactNode
	fallback?:
		| React.ComponentType<{ error: Error; resetError: () => void }>
		| ((props: { error: Error; resetError: () => void }) => React.ReactNode)
	variant?: 'default' | 'session-detail' | 'response-editor' | 'markdown' | 'artifact'
	componentName?: string
	handleRefresh?: () => void
	refreshButtonText?: string
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
		const variant = this.props.variant || 'default'

		// Log with component context
		const logMessage = variant === 'default' ? 'React Error Boundary caught error:' : `${componentName} Error:`

		logger.error(logMessage, error, errorInfo)

		// Report to Sentry with React context (consent checked in beforeSend)
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
				errorBoundaryVariant: variant,
				componentName,
			},
		})
	}

	handleReset = () => {
		// If custom refresh handler provided, use it
		if (this.props.handleRefresh) {
			this.props.handleRefresh()
		} else {
			this.setState({ hasError: false, error: undefined })
		}
	}

	render() {
		if (this.state.hasError) {
			if (this.props.fallback) {
				const fallback = this.props.fallback
				const fallbackProps = {
					error: this.state.error ?? new Error('Unknown error'),
					resetError: this.handleReset,
				}

				// Check if it's a render function or a component
				// Try calling as function first, if it doesn't have React component prototype
				if (typeof fallback === 'function') {
					try {
						// Check if it's a class component
						if (fallback.prototype?.isReactComponent) {
							// It's a class component
							const Fallback = fallback as React.ComponentType<{ error: Error; resetError: () => void }>
							return <Fallback {...fallbackProps} />
						}

						// Try calling as function component or render function
						const result = (
							fallback as (props: { error: Error; resetError: () => void }) => React.ReactNode
						)(fallbackProps)

						// If result is a valid React element, return it
						if (result !== null && result !== undefined) {
							return result as React.ReactElement
						}
					} catch {
						// If calling fails, try as component
						const Fallback = fallback as React.ComponentType<{ error: Error; resetError: () => void }>
						return <Fallback {...fallbackProps} />
					}
				}
			}

			// Render variant-specific fallback
			switch (this.props.variant) {
				case 'session-detail':
					return (
						<div className="flex flex-col items-center justify-center p-8 gap-4">
							<h2 className="text-lg font-semibold text-destructive">Something went wrong</h2>
							<p className="text-sm text-muted-foreground">
								{this.state.error?.message || 'An unexpected error occurred'}
							</p>
							{this.props.handleRefresh && (
								<Button onClick={this.handleReset} variant="outline">
									{this.props.refreshButtonText || 'Refresh'}
								</Button>
							)}
						</div>
					)

				case 'response-editor':
					return (
						<div className="flex flex-col gap-2 p-3 text-sm text-muted-foreground">
							<div className="flex items-center justify-between">
								<div className="flex items-center gap-2">
									<AlertCircle className="w-4 h-4" />
									<span>Editor unavailable</span>
								</div>
								{this.props.handleRefresh && (
									<Button
										onClick={this.handleReset}
										variant="outline"
										size="sm"
										className="h-6 text-xs"
									>
										{this.props.refreshButtonText || 'Refresh'}
									</Button>
								)}
							</div>
							{this.state.error && (
								<div className="text-xs text-destructive">{this.state.error.message}</div>
							)}
						</div>
					)

				case 'markdown':
					return (
						<div className="space-y-2">
							<div className="flex items-center justify-between">
								<span className="text-destructive text-sm">Failed to render content</span>
								{this.props.handleRefresh && (
									<Button
										onClick={this.handleReset}
										variant="outline"
										size="sm"
										className="h-6 text-xs"
									>
										{this.props.refreshButtonText || 'Refresh'}
									</Button>
								)}
							</div>
							<div className="text-muted-foreground text-xs">Raw content shown below:</div>
							<pre className="mt-2 p-2 bg-background-alt border border-border text-muted-foreground text-sm overflow-auto max-h-40">
								{this.state.error?.message || 'Content unavailable'}
							</pre>
						</div>
					)

				case 'artifact':
					return (
						<div className="flex flex-col items-center justify-center p-8 gap-3 text-center">
							<AlertCircle className="w-8 h-8 text-destructive" />
							<h2 className="text-base font-semibold text-destructive">
								Couldn&apos;t display this artifact
							</h2>
							<p className="text-sm text-muted-foreground max-w-md">
								Something went wrong while rendering this artifact. The error has been reported.
							</p>
							<Button onClick={this.handleReset} variant="outline" size="sm" className="gap-2">
								<RefreshCw className="w-4 h-4" />
								{this.props.refreshButtonText || 'Try Again'}
							</Button>
						</div>
					)

				default:
					return (
						<div className="flex flex-col items-center justify-center min-h-[50vh] p-8 text-center">
							<AlertCircle className="w-16 h-16 text-red-500 mb-4" />
							<h1 className="text-2xl font-bold mb-2">Something went wrong</h1>
							<p className="text-muted-foreground mb-6 max-w-md">
								An unexpected error occurred. The error has been reported and we&apos;ll investigate the
								issue.
							</p>
							<Button onClick={this.handleReset} className="gap-2">
								<RefreshCw className="w-4 h-4" />
								Try Again
							</Button>

							<ErrorDetails error={this.state.error} />
						</div>
					)
			}
		}

		return this.props.children
	}
}

// Export wrapped version with Sentry integration
export const SentryErrorBoundary = Sentry.withErrorBoundary(SentryErrorBoundaryCore, {
	showDialog: false, // We handle UI ourselves
})

// Keep ErrorBoundary export for backwards compatibility (will be removed later)
export const ErrorBoundary = SentryErrorBoundary
