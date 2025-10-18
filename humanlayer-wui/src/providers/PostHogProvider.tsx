import { PostHogProvider as PHProvider } from 'posthog-js/react'
import posthog from 'posthog-js'
import React, { useEffect, useRef } from 'react'
import { useStore } from '@/AppStore'
import { shouldInitializePostHog, initializePostHog } from '@/lib/telemetry/posthog'

interface PostHogProviderProps {
  children: React.ReactNode
}

export function PostHogProvider({ children }: PostHogProviderProps) {
  const { userSettings } = useStore()
  const initializedRef = useRef(false)

  // Initialize PostHog once
  useEffect(() => {
    if (!initializedRef.current && shouldInitializePostHog()) {
      initializePostHog()
      initializedRef.current = true

      // Start opted out until we know consent state
      posthog.opt_out_capturing()
      console.log('PostHog initialized (waiting for consent)')
    }
  }, [])

  // Sync consent state
  useEffect(() => {
    if (!initializedRef.current) return

    if (userSettings?.optInTelemetry) {
      posthog.opt_in_capturing()
      // Enable autocapture when user opts in
      posthog.set_config({ autocapture: true })
      console.log('PostHog tracking enabled (user opt-in)')
    } else {
      posthog.opt_out_capturing()
      posthog.set_config({ autocapture: false })
      console.log('PostHog tracking disabled (user opt-out)')
    }
  }, [userSettings?.optInTelemetry])

  if (!shouldInitializePostHog()) {
    return <>{children}</>
  }

  return <PHProvider client={posthog}>{children}</PHProvider>
}
