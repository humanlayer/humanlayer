import { useRouteError, isRouteErrorResponse } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { AlertCircle, RefreshCw } from 'lucide-react'
import * as Sentry from '@sentry/react'
import { useEffect } from 'react'

export function RouteErrorBoundary() {
  const error = useRouteError()

  // Report to Sentry when component mounts with error
  useEffect(() => {
    console.error('Route Error Boundary caught error:', error)

    if (error instanceof Error) {
      // Report to Sentry with route context
      Sentry.captureException(error, {
        tags: {
          errorBoundary: true,
          errorBoundaryType: 'route',
        },
        contexts: {
          route: {
            pathname: window.location.pathname,
            hash: window.location.hash,
          },
        },
      })
    } else if (isRouteErrorResponse(error)) {
      // Handle React Router error responses (404, etc)
      Sentry.captureMessage(`Route error: ${error.status} ${error.statusText}`, {
        level: 'error',
        tags: {
          errorBoundary: true,
          errorBoundaryType: 'route',
          httpStatus: error.status,
        },
      })
    }
  }, [error])

  const handleReset = () => {
    window.location.href = '/'
  }

  // Check if it's a React Router error response (like 404)
  if (isRouteErrorResponse(error)) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-8 text-center">
        <AlertCircle className="w-16 h-16 text-amber-500 mb-4" />
        <h1 className="text-2xl font-bold mb-2">
          {error.status} {error.statusText}
        </h1>
        <p className="text-muted-foreground mb-6 max-w-md">
          {error.data || 'The page you are looking for could not be found.'}
        </p>
        <Button onClick={handleReset} className="gap-2">
          <RefreshCw className="w-4 h-4" />
          Go Home
        </Button>
      </div>
    )
  }

  // Handle regular JavaScript errors
  const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred'
  const errorStack = error instanceof Error ? error.stack : undefined

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-8 text-center">
      <AlertCircle className="w-16 h-16 text-destructive mb-4" />
      <h1 className="text-2xl font-bold mb-2">Something went wrong</h1>
      <p className="text-muted-foreground mb-6 max-w-md">
        {errorMessage}. The error has been reported and we'll investigate the issue.
      </p>
      <Button onClick={handleReset} className="gap-2">
        <RefreshCw className="w-4 h-4" />
        Go Home
      </Button>

      {import.meta.env.DEV && errorStack && (
        <details className="mt-6 text-left max-w-2xl">
          <summary className="cursor-pointer font-mono text-sm">Error Details</summary>
          <pre className="mt-2 text-xs bg-muted p-4 rounded overflow-auto">{errorStack}</pre>
        </details>
      )}
    </div>
  )
}
