import { Button } from '@/components/ui/button'
import { usePostHogTracking } from '@/hooks/usePostHogTracking'
import { usePostHog } from 'posthog-js/react'

export function PostHogTestTrigger() {
  const {trackEvent} = usePostHogTracking()
  const posthog = usePostHog()

  if (!import.meta.env.DEV) {
    return null
  }

  const handleTestTracking = () => {
    console.log('Posthog testing tracking')
    console.log('PostHog has opted out:', posthog?.has_opted_out_capturing())
    console.log('PostHog config:', posthog?.config)

    // Try to track a test event
    trackEvent('test_event', {
      test: true,
      timestamp: new Date().toISOString(),
    })

    console.log('Test event sent (if tracking enabled)')
  }

  return (
    <Button
      onClick={handleTestTracking}
      variant="ghost"
      size="sm"
      className="fixed bottom-20 right-4 opacity-50"
    >
      Test PostHog
    </Button>
  )
}