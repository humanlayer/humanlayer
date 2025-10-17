import { useStore } from '@/AppStore'
import { usePostHog } from 'posthog-js/react'
import { useCallback } from 'react'

export function usePostHogTracking() {
  const posthog = usePostHog()
  const { userSettings } = useStore()

  const trackEvent = useCallback(
    (eventName: string, properties?: Record<string, any>) => {
      console.log('trying to track posthog event ', eventName, 'with properties', properties)
      // Only track if user has opted in and PostHog is initialized
      if (!userSettings?.optInTelemetry || !posthog) {
        console.log(userSettings?.optInTelemetry ? 'posthog not enabled': 'posthog not found')
        return
      }

      // Track the event
      const result = posthog?.capture(eventName, properties)
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

      posthog.capture('$pageview', {
        $current_url: window.location.href,
        page_name: pageName,
      })
    },
    [posthog, userSettings?.optInTelemetry],
  )

  return {
    trackEvent,
    trackPageView,
    isTrackingEnabled: !!userSettings?.optInTelemetry,
  }
}