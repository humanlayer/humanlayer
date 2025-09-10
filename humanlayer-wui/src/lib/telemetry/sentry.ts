import * as Sentry from '@sentry/react'
import { useStore } from '@/AppStore'

// Only initialize in bundled/production builds
const shouldInitializeSentry = (): boolean => {
  // Don't initialize in development
  if (import.meta.env.DEV) {
    return false
  }

  // Don't initialize without DSN
  if (!import.meta.env.VITE_SENTRY_DSN) {
    console.log('Sentry DSN not configured')
    return false
  }

  return true
}

export async function initializeSentry(): Promise<void> {
  if (!shouldInitializeSentry()) {
    console.log('Sentry initialization skipped (development or missing config)')
    return
  }

  try {
    // Check user consent (will be available after first settings load)
    // Note: This creates a dependency on settings being loaded first

    Sentry.init({
      dsn: import.meta.env.VITE_SENTRY_DSN,
      environment: import.meta.env.DEV ? 'development' : 'production',
      release: import.meta.env.VITE_APP_VERSION || 'unknown',

      // Conservative sampling for initial rollout
      tracesSampleRate: 0, // No performance monitoring initially
      replaysSessionSampleRate: 0, // No session replay
      replaysOnErrorSampleRate: 0, // No error replay

      beforeSend(event: Sentry.ErrorEvent) {
        // Double-check user consent at send time
        const state = useStore.getState()
        if (!state.userSettings?.optInTelemetry) {
          return null // Drop event if user opted out
        }

        // Multiple layers of data scrubbing
        return scrubSensitiveData(event)
      },

      beforeBreadcrumb(breadcrumb) {
        // Never capture console logs that might contain sensitive data
        if (breadcrumb.category === 'console') {
          return null
        }

        // Sanitize HTTP requests
        if (breadcrumb.category === 'fetch' || breadcrumb.category === 'xhr') {
          if (breadcrumb.data?.url) {
            // Don't log session API calls at all
            if (breadcrumb.data.url.includes('/api/v1/sessions')) {
              return null
            }
            breadcrumb.data.url = breadcrumb.data.url
              .replace(/query=[^&]*/g, 'query=[FILTERED]')
              .replace(/token=[^&]*/g, 'token=[FILTERED]')
          }
        }

        return breadcrumb
      },

      // Integration configuration
      integrations: [
        Sentry.browserTracingIntegration({
          // Disable automatic instrumentation initially
          enableHTTPTimings: false,
        }),
        Sentry.breadcrumbsIntegration({
          // Never capture console logs that might leak data
          console: false,
        }),
      ],

      // Ignore common noise
      ignoreErrors: [
        'ResizeObserver loop limit exceeded',
        'Non-Error promise rejection captured',
        /extension\//i,
        /^chrome:\/\//i,
        /^moz-extension:\/\//i,
        'Network request failed',
        'Failed to fetch',
      ],
    })

    console.log('Sentry initialized for error reporting')
  } catch (error) {
    console.error('Failed to initialize Sentry:', error)
  }
}

export function scrubSensitiveData<T extends Sentry.Event>(event: T): T {
  // Remove any reference to Zustand stores completely
  if (event.contexts?.state) {
    delete event.contexts.state
  }

  // Scrub request data
  if (event.request?.url) {
    event.request.url = event.request.url
      .replace(/api_key=[^&]+/g, 'api_key=REDACTED')
      .replace(/token=[^&]+/g, 'token=REDACTED')
      .replace(/query=[^&]+/g, 'query=REDACTED')
  }

  // Remove sensitive headers
  if (event.request?.headers) {
    const cleanHeaders = { ...event.request.headers }
    delete cleanHeaders['Authorization']
    delete cleanHeaders['X-API-Key']
    delete cleanHeaders['Cookie']
    event.request.headers = cleanHeaders
  }

  // Anonymize user data
  if (event.user) {
    event.user = {
      id: hashString(String(event.user.id || 'anonymous')),
    }
  }

  // Scrub breadcrumbs for sensitive data
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs
      .filter(breadcrumb => {
        // Remove any breadcrumb mentioning sensitive operations
        if (breadcrumb.message?.includes('store') || breadcrumb.category?.includes('zustand')) {
          return false
        }
        return true
      })
      .map(breadcrumb => {
        if (breadcrumb.data) {
          const sanitized = { ...breadcrumb.data }
          // Remove common sensitive fields
          delete sanitized.prompt
          delete sanitized.query
          delete sanitized.file_content
          delete sanitized.api_key
          delete sanitized.working_directory
          delete sanitized.messages
          delete sanitized.conversation
          delete sanitized.session
          delete sanitized.approval
          breadcrumb.data = sanitized
        }
        return breadcrumb
      })
  }

  // Aggressively scrub extra context data
  if (event.extra) {
    const sensitiveKeys = [
      'store', 'state', 'session', 'conversation', 'approval', 'messages',
      'prompt', 'file_content', 'working_directory', 'api_key'
    ]
    Object.keys(event.extra).forEach(key => {
      // Remove any key that might contain sensitive data
      if (sensitiveKeys.some(sensitive => key.toLowerCase().includes(sensitive))) {
        delete event.extra![key]
      }
      // Also check the value if it's an object
      if (typeof event.extra![key] === 'object' && event.extra![key] !== null) {
        const str = JSON.stringify(event.extra![key])
        if (sensitiveKeys.some(sensitive => str.toLowerCase().includes(sensitive))) {
          delete event.extra![key]
        }
      }
    })
  }

  return event
}

// Simple hash for anonymization (matching PostHog pattern)
function hashString(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash
  }
  return Math.abs(hash).toString(36)
}

// Export function for manual error capture
export function captureException(error: Error, context?: Record<string, any>) {
  const state = useStore.getState()
  if (!state.userSettings?.optInTelemetry) {
    return // Don't capture if user opted out
  }

  Sentry.captureException(error, {
    extra: context ? scrubSensitiveData({ extra: context } as Sentry.ErrorEvent).extra : undefined,
  })
}

// Export function for manual message capture
export function captureMessage(
  message: string,
  level: Sentry.SeverityLevel = 'info',
  context?: Record<string, any>,
) {
  const state = useStore.getState()
  if (!state.userSettings?.optInTelemetry) {
    return
  }

  Sentry.captureMessage(message, {
    level,
    extra: context ? scrubSensitiveData({ extra: context } as Sentry.ErrorEvent).extra : undefined,
  })
}
