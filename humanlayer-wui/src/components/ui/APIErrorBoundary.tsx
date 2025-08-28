import React, { ReactNode } from 'react'
import { BaseErrorBoundary, BaseErrorBoundaryProps, ErrorBoundaryInfo } from './BaseErrorBoundary'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ConnectionError, DaemonError, RPCError } from '@/lib/daemon/errors'
import { logger } from '@/lib/logging'
import { cn } from '@/lib/utils'

/**
 * Configuration for retry behavior
 */
interface RetryConfig {
  /** Maximum number of retry attempts */
  maxRetries: number
  /** Base delay between retries in milliseconds */
  baseDelay: number
  /** Whether to use exponential backoff */
  exponentialBackoff: boolean
  /** Maximum delay between retries in milliseconds */
  maxDelay: number
}

/**
 * Props interface for APIErrorBoundary component
 */
interface APIErrorBoundaryProps extends Omit<BaseErrorBoundaryProps, 'fallback' | 'onRetry'> {
  /** Custom fallback for API errors */
  fallback?: (errorInfo: APIErrorBoundaryInfo) => ReactNode
  /** Custom retry handler for API operations */
  onRetry?: (retryAttempt: number, error: Error) => Promise<void> | void
  /** Configuration for automatic retry behavior */
  retryConfig?: Partial<RetryConfig>
  /** Whether to automatically attempt reconnection for connection errors */
  autoReconnect?: boolean
  /** Timeout in milliseconds for reconnection attempts */
  reconnectionTimeout?: number
  /** Whether to show detailed network error information */
  showNetworkDetails?: boolean
  /** Context about the API operation that failed (e.g., 'fetching sessions', 'creating approval') */
  operationContext?: string
}

/**
 * Extended error information specific to API errors
 */
interface APIErrorBoundaryInfo extends ErrorBoundaryInfo {
  /** Number of retry attempts made */
  retryAttempt: number
  /** Whether an automatic retry is in progress */
  retrying: boolean
  /** Whether automatic reconnection is in progress */
  reconnecting: boolean
  /** The specific API error type */
  apiErrorType: 'connection' | 'daemon' | 'rpc' | 'network' | 'timeout' | 'unknown'
  /** User-friendly error message */
  userMessage: string
  /** Suggested recovery actions */
  recoveryActions: string[]
  /** Retry with exponential backoff */
  retryWithBackoff: () => Promise<void>
}

/**
 * Default retry configuration
 */
const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelay: 1000,
  exponentialBackoff: true,
  maxDelay: 10000,
}

/**
 * APIErrorBoundary - Specialized error boundary for API-dependent components
 *
 * This component extends BaseErrorBoundary with specific handling for API-related errors,
 * including network failures, daemon connection issues, and RPC errors. It provides
 * intelligent retry mechanisms with exponential backoff and user-friendly error messages
 * for common API failure scenarios.
 *
 * Features:
 * - Automatic error type detection (connection, daemon, RPC, network, timeout)
 * - Exponential backoff retry mechanism with configurable parameters
 * - Automatic reconnection attempts for connection errors
 * - User-friendly error messages with actionable recovery suggestions
 * - Integration with existing daemon client error patterns
 * - Context-aware error reporting (includes operation context)
 * - Progressive disclosure of technical details
 *
 * @example
 * ```tsx
 * // Basic usage around API-dependent component
 * <APIErrorBoundary operationContext="fetching session list">
 *   <SessionTable />
 * </APIErrorBoundary>
 *
 * // With custom retry logic
 * <APIErrorBoundary
 *   operationContext="creating new session"
 *   onRetry={async (attempt, error) => {
 *     await daemonClient.reconnect()
 *     await store.refreshSessions()
 *   }}
 *   retryConfig={{ maxRetries: 5, baseDelay: 2000 }}
 * >
 *   <SessionLauncher />
 * </APIErrorBoundary>
 *
 * // With auto-reconnection for critical components
 * <APIErrorBoundary
 *   operationContext="real-time event subscription"
 *   autoReconnect={true}
 *   showNetworkDetails={true}
 * >
 *   <ConversationView />
 * </APIErrorBoundary>
 * ```
 */
export function APIErrorBoundary({
  children,
  fallback,
  onRetry,
  retryConfig = {},
  autoReconnect = true,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  reconnectionTimeout: _reconnectionTimeout = 10000,
  showNetworkDetails = false,
  operationContext,
  contextInfo,
  ...baseProps
}: APIErrorBoundaryProps) {
  const [retryAttempt, setRetryAttempt] = React.useState(0)
  const [retrying, setRetrying] = React.useState(false)
  const [reconnecting, setReconnecting] = React.useState(false)
  const retryTimeoutRef = React.useRef<ReturnType<typeof setTimeout>>()

  const config: RetryConfig = { ...DEFAULT_RETRY_CONFIG, ...retryConfig }

  /**
   * Determine the type of API error and generate appropriate user messaging
   */
  const analyzeAPIError = (
    error: Error,
  ): {
    apiErrorType: APIErrorBoundaryInfo['apiErrorType']
    userMessage: string
    recoveryActions: string[]
  } => {
    // Connection errors
    if (error instanceof ConnectionError || error.message.includes('Cannot connect to daemon')) {
      return {
        apiErrorType: 'connection',
        userMessage:
          'Unable to connect to the HumanLayer daemon. The daemon may not be running or may be temporarily unavailable.',
        recoveryActions: [
          'Check that the HumanLayer daemon (hld) is running',
          'Restart the daemon if necessary',
          'Check your network connection',
          'Try refreshing the page',
        ],
      }
    }

    // Daemon-specific errors
    if (error instanceof DaemonError) {
      return {
        apiErrorType: 'daemon',
        userMessage: `The HumanLayer daemon encountered an error${operationContext ? ` while ${operationContext}` : ''}.`,
        recoveryActions: [
          'The daemon may be experiencing temporary issues',
          'Try the operation again in a moment',
          'Check the daemon logs for more details',
          'Restart the daemon if the problem persists',
        ],
      }
    }

    // RPC errors
    if (error instanceof RPCError) {
      return {
        apiErrorType: 'rpc',
        userMessage: `Communication with the daemon failed${operationContext ? ` while ${operationContext}` : ''}.`,
        recoveryActions: [
          'The request may have timed out or been corrupted',
          'Try the operation again',
          'Check your network stability',
          'Restart the application if the issue continues',
        ],
      }
    }

    // Network/fetch errors
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      return {
        apiErrorType: 'network',
        userMessage:
          'Network request failed. This could be due to connectivity issues or server problems.',
        recoveryActions: [
          'Check your internet connection',
          'Try refreshing the page',
          'The server may be temporarily unavailable',
          'Contact support if the issue persists',
        ],
      }
    }

    // Timeout errors
    if (error.name === 'AbortError' || error.message.includes('timeout')) {
      return {
        apiErrorType: 'timeout',
        userMessage: `The operation timed out${operationContext ? ` while ${operationContext}` : ''}.`,
        recoveryActions: [
          'The operation took longer than expected',
          'Try the operation again',
          'Check your network connection',
          'The server may be under heavy load',
        ],
      }
    }

    // Generic API errors
    return {
      apiErrorType: 'unknown',
      userMessage: `An unexpected error occurred${operationContext ? ` while ${operationContext}` : ''}.`,
      recoveryActions: [
        'This appears to be an unexpected issue',
        'Try the operation again',
        'Refresh the page if the problem continues',
        'Check the console for technical details',
      ],
    }
  }

  /**
   * Calculate delay for exponential backoff
   */
  const calculateRetryDelay = (attempt: number): number => {
    if (!config.exponentialBackoff) {
      return config.baseDelay
    }

    const exponentialDelay = config.baseDelay * Math.pow(2, attempt)
    return Math.min(exponentialDelay, config.maxDelay)
  }

  /**
   * Perform retry with exponential backoff
   */
  const handleRetryWithBackoff = async (): Promise<void> => {
    if (retryAttempt >= config.maxRetries) {
      logger.warn(`Maximum retry attempts (${config.maxRetries}) reached, not retrying`)
      return
    }

    setRetrying(true)
    const nextAttempt = retryAttempt + 1
    const delay = calculateRetryDelay(nextAttempt)

    logger.log(
      `Retrying API operation (attempt ${nextAttempt}/${config.maxRetries}) after ${delay}ms delay`,
    )

    try {
      // Wait for the calculated delay
      await new Promise(resolve => {
        retryTimeoutRef.current = setTimeout(resolve, delay)
      })

      setRetryAttempt(nextAttempt)

      // Call custom retry handler if provided
      if (onRetry) {
        await onRetry(nextAttempt, new Error('Retry attempt'))
      }

      // If we reach here, retry was successful, so we can reset
      setRetryAttempt(0)
    } catch (retryError) {
      logger.error(`Retry attempt ${nextAttempt} failed:`, retryError)
    } finally {
      setRetrying(false)
    }
  }

  /**
   * Handle automatic reconnection for connection errors
   */
  const handleAutoReconnect = async (): Promise<void> => {
    if (!autoReconnect) return

    setReconnecting(true)
    logger.log('Attempting automatic reconnection...')

    try {
      // Import daemon client dynamically to avoid circular dependencies
      const { daemonClient } = await import('@/lib/daemon/client')
      await daemonClient.reconnect()

      logger.log('Automatic reconnection successful')

      // Reset retry attempt counter on successful reconnection
      setRetryAttempt(0)
    } catch (reconnectError) {
      logger.error('Automatic reconnection failed:', reconnectError)
    } finally {
      setReconnecting(false)
    }
  }

  /**
   * Enhanced retry handler that includes auto-reconnection logic
   */
  const handleAPIRetry = async () => {
    // For connection errors, attempt reconnection first
    if (autoReconnect) {
      await handleAutoReconnect()
    }

    // Then attempt retry with backoff
    await handleRetryWithBackoff()
  }

  /**
   * Render API-specific error fallback
   */
  const renderAPIFallback = (baseErrorInfo: ErrorBoundaryInfo): ReactNode => {
    const { error } = baseErrorInfo
    const { apiErrorType, userMessage, recoveryActions } = analyzeAPIError(error)

    const apiErrorInfo: APIErrorBoundaryInfo = {
      ...baseErrorInfo,
      retryAttempt,
      retrying,
      reconnecting,
      apiErrorType,
      userMessage,
      recoveryActions,
      retryWithBackoff: handleRetryWithBackoff,
    }

    // Use custom fallback if provided
    if (fallback) {
      return fallback(apiErrorInfo)
    }

    // Default API error fallback UI
    const isConnectionError = apiErrorType === 'connection'
    const canRetry = retryAttempt < config.maxRetries

    return (
      <div className={cn('flex items-center justify-center p-4 min-h-[300px]', baseProps.className)}>
        <Card className="max-w-lg w-full">
          <CardHeader>
            <CardTitle className="text-destructive flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-destructive" />
              {isConnectionError ? 'Connection Failed' : 'API Error'}
            </CardTitle>
            <CardDescription>{userMessage}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Recovery Actions */}
            <div className="space-y-2">
              <div className="text-sm font-medium">What you can try:</div>
              <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
                {recoveryActions.map((action, index) => (
                  <li key={index}>{action}</li>
                ))}
              </ul>
            </div>

            {/* Retry Information */}
            {retryAttempt > 0 && (
              <div className="p-3 bg-muted rounded border">
                <div className="text-xs text-muted-foreground">
                  Retry attempt: {retryAttempt} / {config.maxRetries}
                </div>
                {retrying && (
                  <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2">
                    <div className="w-3 h-3 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                    Retrying operation...
                  </div>
                )}
                {reconnecting && (
                  <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2">
                    <div className="w-3 h-3 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                    Attempting to reconnect...
                  </div>
                )}
              </div>
            )}

            {/* Technical Details */}
            {showNetworkDetails && (
              <details className="space-y-2">
                <summary className="text-sm font-medium cursor-pointer text-muted-foreground hover:text-foreground">
                  Technical Details
                </summary>
                <div className="p-3 bg-muted rounded border font-mono text-xs space-y-2">
                  <div>
                    <span className="font-semibold">Error Type:</span> {apiErrorType}
                  </div>
                  <div>
                    <span className="font-semibold">Message:</span> {error.message}
                  </div>
                  {operationContext && (
                    <div>
                      <span className="font-semibold">Operation:</span> {operationContext}
                    </div>
                  )}
                  <div>
                    <span className="font-semibold">Timestamp:</span> {new Date().toISOString()}
                  </div>
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
                </div>
              </details>
            )}

            {/* Action Buttons */}
            <div className="flex gap-2 justify-end">
              {canRetry && (
                <Button
                  onClick={handleAPIRetry}
                  variant="outline"
                  size="sm"
                  disabled={retrying || reconnecting}
                >
                  {retrying || reconnecting ? (
                    <>
                      <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />
                      {reconnecting ? 'Reconnecting...' : 'Retrying...'}
                    </>
                  ) : (
                    `Try Again ${retryAttempt > 0 ? `(${config.maxRetries - retryAttempt} left)` : ''}`
                  )}
                </Button>
              )}
              <Button
                onClick={baseErrorInfo.reload}
                variant="default"
                size="sm"
                disabled={retrying || reconnecting}
              >
                Reload Page
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Clean up timeouts on unmount
  React.useEffect(() => {
    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current)
      }
    }
  }, [])

  // Enhanced context info for API errors
  const enhancedContextInfo = {
    ...contextInfo,
    operationContext,
    apiErrorBoundary: true,
    retryConfig: config,
    autoReconnect,
  }

  return (
    <BaseErrorBoundary
      {...baseProps}
      contextInfo={enhancedContextInfo}
      fallback={renderAPIFallback}
      onRetry={handleAPIRetry}
    >
      {children}
    </BaseErrorBoundary>
  )
}

export type { APIErrorBoundaryProps, APIErrorBoundaryInfo, RetryConfig }
