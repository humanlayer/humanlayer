import { useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { toast } from 'sonner'
import { captureException } from '@/lib/telemetry/sentry'
import { getAppVersion } from '@/lib/version'

// Component that intentionally throws an error for testing
function ErrorBomb(): never {
  // This will throw during render, which React Error Boundary will catch
  throw new Error('React Error Boundary test - intentionally triggered')
}

// This component is intentionally shipped to production for testing
// It's only accessible via a hidden keyboard shortcut
export function TestErrorTrigger() {
  const [shouldCrash, setShouldCrash] = useState(false)

  // Cmd+Shift+Alt+E - Send test error via captureException (doesn't crash app)
  useHotkeys(
    'meta+shift+alt+e',
    e => {
      console.log('[TestErrorTrigger] Hotkey triggered!')
      e.preventDefault()

      // Create a safe test error with no sensitive data
      const testError = new Error('Sentry test error - intentionally triggered')
      testError.name = 'TestError'

      // Add safe metadata
      captureException(testError, {
        testType: 'manual_trigger',
        timestamp: new Date().toISOString(),
        version: getAppVersion(),
        // Explicitly no sensitive data
      })

      toast.info('Test error sent to Sentry (if telemetry is enabled)')
    },
    {
      enableOnFormTags: false,
      preventDefault: true,
    },
  )

  // Cmd+Shift+Alt+B - Trigger React error boundary (crashes component)
  useHotkeys(
    'meta+shift+alt+b',
    () => {
      console.log('[TestErrorTrigger] Triggering React Error Boundary test!')
      toast.warning('Triggering Error Boundary in 1 second...')

      // Give user time to see the toast before crashing
      setTimeout(() => {
        setShouldCrash(true)
      }, 1000)
    },
    {
      enableOnFormTags: false,
    },
  )

  // If shouldCrash is true, render the ErrorBomb component which throws
  if (shouldCrash) {
    return <ErrorBomb />
  }

  return null // No UI, keyboard shortcut only
}
