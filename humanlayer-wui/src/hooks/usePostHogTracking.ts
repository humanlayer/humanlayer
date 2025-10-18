import { useStore } from '@/AppStore'
import { AllowedPostHogKey, sanitizeEventProperties } from '@/lib/telemetry/posthog-sanitizer'
import { usePostHog } from 'posthog-js/react'
import { useCallback } from 'react'

export function usePostHogTracking() {
  const posthog = usePostHog()
  const { userSettings } = useStore()

  const trackEvent = useCallback(
    (eventName: string, properties?: Record<AllowedPostHogKey, any>) => {
      console.log('trying to track posthog event ', eventName, 'with properties', properties)
      // Only track if user has opted in and PostHog is initialized
      if (!userSettings?.optInTelemetry || !posthog) {
        console.log(userSettings?.optInTelemetry ? 'posthog not enabled': 'posthog not found')
        return
      }

      // Sanitize properties before sending
      const sanitizedProperties = properties ? sanitizeEventProperties(properties) : undefined

      // Track the event
      const result = posthog?.capture(eventName, sanitizedProperties)
      if (!result) console.log('failed to track posthog event')

      console.log('posthog event tracked!', result?.event, result?.uuid, result?.properties, result?.timestamp)
    },
    [posthog, userSettings, userSettings?.optInTelemetry],
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