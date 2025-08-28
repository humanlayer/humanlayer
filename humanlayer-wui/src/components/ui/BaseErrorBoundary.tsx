import React, { Component, ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { logger } from '@/lib/logging'
import { cn } from '@/lib/utils'

/**
 * Props interface for BaseErrorBoundary component
 */
interface BaseErrorBoundaryProps {
  /** Child components to render when no error occurs */
  children: ReactNode
  /** Custom fallback component to render instead of default error UI */
  fallback?: (errorInfo: ErrorBoundaryInfo) => ReactNode
  /** Custom error handler called when an error is caught */
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void
  /** Additional CSS classes for the error container */
  className?: string
  /** Title for the error display */
  title?: string
  /** Description for the error display */
  description?: string
  /** Whether to show technical error details to the user */
  showErrorDetails?: boolean
  /** Whether to show the reload button */
  showReloadButton?: boolean
  /** Whether to show the retry button */
  showRetryButton?: boolean
  /** Custom retry handler. If not provided, component will reset its error state */
  onRetry?: () => void
  /** Context information to include in error logs */
  contextInfo?: Record<string, any>
}

/**
 * Error information passed to fallback components and error handlers
 */
interface ErrorBoundaryInfo {
  error: Error
  errorInfo: React.ErrorInfo
  hasError: boolean
  retry: () => void
  reload: () => void
  contextInfo?: Record<string, any>
}

/**
 * Internal state for the error boundary
 */
interface BaseErrorBoundaryState {
  hasError: boolean
  error: Error | null
  errorInfo: React.ErrorInfo | null
  errorId: string | null
}

/**
 * BaseErrorBoundary - Foundational error boundary component with comprehensive error handling
 *
 * This component provides a robust foundation for error boundaries throughout the application.
 * It handles error state management, logging integration, and provides flexible UI fallbacks
 * with consistent styling using the application's design tokens.
 *
 * Features:
 * - Error state management with retry/reload capabilities
 * - Integration with existing logger for consistent error reporting
 * - Customizable fallback UI with default implementation
 * - Support for both technical and user-friendly error displays
 * - Context information for better debugging
 * - Follows the "2AM debug test" - errors are clear and actionable
 *
 * @example
 * ```tsx
 * // Basic usage
 * <BaseErrorBoundary>
 *   <SomeComponent />
 * </BaseErrorBoundary>
 *
 * // With custom error handling
 * <BaseErrorBoundary
 *   title="Failed to load dashboard"
 *   onError={(error, errorInfo) => analytics.track('dashboard_error', { error })}
 *   contextInfo={{ userId: user.id, route: '/dashboard' }}
 * >
 *   <Dashboard />
 * </BaseErrorBoundary>
 *
 * // With custom fallback
 * <BaseErrorBoundary
 *   fallback={({ error, retry }) => (
 *     <CustomErrorDisplay error={error} onRetry={retry} />
 *   )}
 * >
 *   <ComplexComponent />
 * </BaseErrorBoundary>
 * ```
 */
export class BaseErrorBoundary extends Component<BaseErrorBoundaryProps, BaseErrorBoundaryState> {
  private retryTimeoutId: ReturnType<typeof setTimeout> | null = null

  constructor(props: BaseErrorBoundaryProps) {
    super(props)
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      errorId: null,
    }
  }

  /**
   * Static method called when an error occurs during rendering
   */
  static getDerivedStateFromError(error: Error): Partial<BaseErrorBoundaryState> {
    // Generate unique error ID for tracking
    const errorId = `ERR_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`

    return {
      hasError: true,
      error,
      errorId,
    }
  }

  /**
   * Called after an error has been thrown by a descendant component
   */
  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    const { onError, contextInfo } = this.props

    // Create comprehensive error context for logging
    const errorContext = {
      errorId: this.state.errorId,
      component: errorInfo.componentStack,
      timestamp: new Date().toISOString(),
      userAgent: typeof window !== 'undefined' ? window.navigator?.userAgent : 'unknown',
      url: typeof window !== 'undefined' ? window.location?.href : 'unknown',
      ...contextInfo,
    }

    // Log error with full context
    logger.error(
      `BaseErrorBoundary caught error [${this.state.errorId}]:`,
      {
        message: error.message,
        stack: error.stack,
        name: error.name,
        cause: error.cause,
      },
      'Error Info:',
      errorContext,
      'Component Stack:',
      errorInfo.componentStack,
      'React Error Info:',
      errorInfo,
    )

    // Store error info in state for fallback rendering
    this.setState({ errorInfo })

    // Call custom error handler if provided
    if (onError) {
      try {
        onError(error, errorInfo)
      } catch (handlerError) {
        logger.error('Custom error handler threw an error:', handlerError)
      }
    }
  }

  /**
   * Clean up any pending timeouts when component unmounts
   */
  componentWillUnmount() {
    if (this.retryTimeoutId) {
      clearTimeout(this.retryTimeoutId)
    }
  }

  /**
   * Reset error state and attempt to re-render children
   */
  private handleRetry = () => {
    const { onRetry } = this.props

    logger.log(`Retrying after error [${this.state.errorId}]`)

    if (onRetry) {
      try {
        onRetry()
      } catch (retryError) {
        logger.error('Custom retry handler failed:', retryError)
      }
    }

    // Reset error state with a slight delay to prevent immediate re-error
    this.retryTimeoutId = setTimeout(() => {
      this.setState({
        hasError: false,
        error: null,
        errorInfo: null,
        errorId: null,
      })
    }, 100)
  }

  /**
   * Reload the entire page
   */
  private handleReload = () => {
    logger.log(`Reloading page after error [${this.state.errorId}]`)

    if (typeof window !== 'undefined') {
      window.location.reload()
    }
  }

  /**
   * Render the default error fallback UI
   */
  private renderDefaultFallback = (errorBoundaryInfo: ErrorBoundaryInfo): ReactNode => {
    const {
      title = 'Something went wrong',
      description = 'An unexpected error occurred. You can try to recover by retrying the operation.',
      showErrorDetails = false,
      showRetryButton = true,
      showReloadButton = true,
      className,
    } = this.props

    const { error, errorInfo, errorId } = this.state

    return (
      <div className={cn('flex items-center justify-center p-4 min-h-[200px]', className)}>
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle className="text-destructive">{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {showErrorDetails && error && (
              <div className="space-y-2">
                <div className="text-xs text-muted-foreground font-mono">Error ID: {errorId}</div>
                <div className="p-3 bg-muted rounded border font-mono text-xs">
                  <div className="font-semibold text-destructive">{error.name}:</div>
                  <div className="break-words">{error.message}</div>
                  {error.stack && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                        Stack trace
                      </summary>
                      <pre className="mt-2 text-[10px] overflow-auto max-h-32 whitespace-pre-wrap">
                        {error.stack}
                      </pre>
                    </details>
                  )}
                  {errorInfo?.componentStack && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                        Component stack
                      </summary>
                      <pre className="mt-2 text-[10px] overflow-auto max-h-32 whitespace-pre-wrap">
                        {errorInfo.componentStack}
                      </pre>
                    </details>
                  )}
                </div>
              </div>
            )}

            <div className="flex gap-2 justify-end">
              {showRetryButton && (
                <Button onClick={errorBoundaryInfo.retry} variant="outline" size="sm">
                  Try Again
                </Button>
              )}
              {showReloadButton && (
                <Button onClick={errorBoundaryInfo.reload} variant="default" size="sm">
                  Reload Page
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  render() {
    const { children, fallback } = this.props
    const { hasError, error, errorInfo } = this.state

    if (hasError && error) {
      const errorBoundaryInfo: ErrorBoundaryInfo = {
        error,
        errorInfo: errorInfo!,
        hasError,
        retry: this.handleRetry,
        reload: this.handleReload,
        contextInfo: this.props.contextInfo,
      }

      // Use custom fallback if provided, otherwise use default
      if (fallback) {
        try {
          return fallback(errorBoundaryInfo)
        } catch (fallbackError) {
          logger.error('Custom fallback component threw an error:', fallbackError)
          // Fall back to default UI if custom fallback fails
          return this.renderDefaultFallback(errorBoundaryInfo)
        }
      }

      return this.renderDefaultFallback(errorBoundaryInfo)
    }

    return children
  }
}

export type { BaseErrorBoundaryProps, ErrorBoundaryInfo }
