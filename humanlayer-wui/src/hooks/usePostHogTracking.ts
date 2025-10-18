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
      // Only track if user has opted in and PostHog is initialized
      if (!userSettings?.optInTelemetry || !posthog) {
        return
      }

      // Sanitize properties before sending
      const sanitizedProperties = properties ? sanitizeEventProperties(properties) : undefined

      // Track the event
      posthog.capture(eventName, sanitizedProperties)
    },
    [posthog, userSettings?.optInTelemetry],
  )

  const trackPageView = useCallback(
    (pageName?: string) => {
      if (!userSettings?.optInTelemetry || !posthog) {
        return
      }

      // PostHog automatically captures $current_url, $host, $pathname, etc.
      // We just add optional custom properties (these are whitelisted)
      posthog.capture('$pageview', pageName ? { page_name: pageName } : undefined)
    },
    [posthog, userSettings?.optInTelemetry],
  )

  return {
    trackEvent,
    trackPageView,
    isTrackingEnabled: !!userSettings?.optInTelemetry,
  }
}
