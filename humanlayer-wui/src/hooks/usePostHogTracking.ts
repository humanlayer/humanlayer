import { useStore } from '@/AppStore'
import { PostHogEvent } from '@/lib/telemetry/events'
import { AllowedPostHogKey, sanitizeEventProperties } from '@/lib/telemetry/posthog-sanitizer'
import { usePostHog } from 'posthog-js/react'
import { useCallback } from 'react'

export function usePostHogTracking() {
  const posthog = usePostHog()
  const { userSettings } = useStore()

  const trackEvent = useCallback(
    (eventName: PostHogEvent, properties?: Partial<Record<AllowedPostHogKey, any>>) => {
      try {
        // Only track if user has opted in and PostHog is initialized
        if (!userSettings?.optInTelemetry || !posthog) {
          return
        }

        // Sanitize properties before sending
        const sanitizedProperties = properties ? sanitizeEventProperties(properties) : undefined

        // Track the event
        posthog.capture(eventName, sanitizedProperties)
      } catch (error) {
        // Log error but never throw to caller - tracking failures should not break the app
        console.error('[PostHog] Failed to track event:', {
          eventName,
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
        })
      }
    },
    [posthog, userSettings?.optInTelemetry],
  )

  const trackPageView = useCallback(
    (pageName?: string) => {
      try {
        if (!userSettings?.optInTelemetry || !posthog) {
          return
        }

        // PostHog automatically captures $current_url, $host, $pathname, etc.
        // We just add optional custom properties (these are whitelisted)
        posthog.capture('$pageview', pageName ? { page_name: pageName } : undefined)
      } catch (error) {
        // Log error but never throw to caller - tracking failures should not break the app
        console.error('[PostHog] Failed to track pageview:', {
          pageName,
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
        })
      }
    },
    [posthog, userSettings?.optInTelemetry],
  )

  return {
    trackEvent,
    trackPageView,
    isTrackingEnabled: !!userSettings?.optInTelemetry,
  }
}
