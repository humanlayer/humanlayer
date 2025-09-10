import { useHotkeys } from 'react-hotkeys-hook'
import { toast } from 'sonner'
import { captureException } from '@/lib/telemetry/sentry'

// This component is intentionally shipped to production for testing
// It's only accessible via a hidden keyboard shortcut
export function TestErrorTrigger() {
  console.log('[TestErrorTrigger] Component mounted')
  
  useHotkeys(
    'meta+shift+alt+e',
    (e) => {
      console.log('[TestErrorTrigger] Hotkey triggered!')
      e.preventDefault()
      
      // Create a safe test error with no sensitive data
      const testError = new Error('Sentry test error - intentionally triggered')
      testError.name = 'TestError'
      
      // Add safe metadata
      captureException(testError, {
        testType: 'manual_trigger',
        timestamp: new Date().toISOString(),
        version: import.meta.env.VITE_APP_VERSION,
        // Explicitly no sensitive data
      })
      
      toast.info('Test error sent to Sentry (if telemetry is enabled)')
    },
    {
      enableOnFormTags: false,
      preventDefault: true,
    }
  )
  
  return null // No UI, keyboard shortcut only
}