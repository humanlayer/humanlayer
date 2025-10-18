import { usePostHogTracking } from '@/hooks/usePostHogTracking'
import { POSTHOG_EVENTS } from '@/lib/telemetry/events'
import { getAppVersion, getBuildType } from '@/lib/version'
import { useEffect, useRef } from 'react'

export function AppLaunchTracker() {
  const { trackEvent, isTrackingEnabled } = usePostHogTracking()
  const hasTrackedLaunch = useRef(false)

  useEffect(() => {
    // Only track once and only if tracking is enabled
    if (isTrackingEnabled && !hasTrackedLaunch.current) {
      trackEvent(POSTHOG_EVENTS.APP_LAUNCHED, {
        app_version: getAppVersion(),
        build_type: getBuildType(),
      })

      hasTrackedLaunch.current = true
    }
  }, [isTrackingEnabled, trackEvent])

  return null // This component doesn't render anything
}
