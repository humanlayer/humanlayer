import React from 'react'
import * as Sentry from '@sentry/react'
import { Button } from '@/components/ui/button'
import { AlertCircle, RefreshCw } from 'lucide-react'
import { logger } from '@/lib/logging'

interface Props {
  children: React.ReactNode
  fallback?: React.ComponentType<{ error: Error; resetError: () => void }>
  variant?: 'default' | 'session-detail' | 'response-editor' | 'markdown'
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
    const logMessage =
      variant === 'default' ? 'React Error Boundary caught error:' : `${componentName} Error:`

    console.error(logMessage, error, errorInfo)
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
        const Fallback = this.props.fallback
        return <Fallback error={this.state.error!} resetError={this.handleReset} />
      }

      // Render variant-specific fallback
      switch (this.props.variant) {
        case 'session-detail':
          return (
            <div className="flex flex-col items-center justify-center p-8 space-y-4">
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
            <div className="flex flex-col space-y-2 p-3 text-sm text-muted-foreground">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
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

        default:
          return (
            <div className="flex flex-col items-center justify-center min-h-[50vh] p-8 text-center">
              <AlertCircle className="w-16 h-16 text-red-500 mb-4" />
              <h1 className="text-2xl font-bold mb-2">Something went wrong</h1>
              <p className="text-muted-foreground mb-6 max-w-md">
                An unexpected error occurred. The error has been reported and we'll investigate the
                issue.
              </p>
              <Button onClick={this.handleReset} className="gap-2">
                <RefreshCw className="w-4 h-4" />
                Try Again
              </Button>

              {import.meta.env.DEV && this.state.error && (
                <details className="mt-6 text-left">
                  <summary className="cursor-pointer font-mono text-sm">
                    Error Details 
                  </summary>
                  <pre className="mt-2 text-xs bg-muted p-4 rounded overflow-auto">
                    {this.state.error.stack}
                  </pre>
                </details>
              )}
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
