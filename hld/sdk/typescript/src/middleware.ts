import { Middleware, ErrorContext } from './generated/runtime'

export interface ErrorInterceptorOptions {
  onError?: (error: Error, context: ErrorContext) => void
  logErrors?: boolean
}

export function createErrorInterceptor(options: ErrorInterceptorOptions = {}): Middleware {
  const { onError, logErrors = true } = options

  return {
    async onError(context: ErrorContext): Promise<Response | void> {
      const error = context.error instanceof Error ? context.error : new Error(String(context.error))

      // Log error for debugging
      if (logErrors) {
        console.error('[HLD SDK] Fetch error:', {
          url: context.url,
          method: context.init.method,
          error: error.message,
        })
      }

      // Call custom error handler if provided
      if (onError) {
        onError(error, context)
      }

      // Don't return alternative response - let error propagate
      // but we've logged it for debugging
      return undefined
    }
  }
}