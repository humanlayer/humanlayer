import { daemonClient } from '@/lib/daemon'
import { useHotkeysContext } from 'react-hotkeys-hook'
import { logger } from '@/lib/logging'
import { useStore } from '@/AppStore'

const LAST_WORKING_DIR_KEY = 'humanlayer-last-working-dir'

// Export localStorage key helpers
export const getLastWorkingDir = () => localStorage.getItem(LAST_WORKING_DIR_KEY)
export const setLastWorkingDir = (dir: string) => localStorage.setItem(LAST_WORKING_DIR_KEY, dir)

// Helper hook for global hotkey management
export function useSessionLauncherHotkeys() {
  const { activeScopes } = useHotkeysContext()
  const refreshSessions = useStore(state => state.refreshSessions)

  // Helper to check if user is actively typing in a text input
  const isTypingInInput = () => {
    const active = document.activeElement
    if (!active) return false

    // Only block hotkeys when actively typing in actual input fields
    return (
      active.tagName === 'INPUT' ||
      active.tagName === 'TEXTAREA' ||
      (active as HTMLElement).contentEditable === 'true'
    )
  }

  // Check if a modal scope is active (indicating a modal is open)
  const isModalScopeActive = () => {
    // Only check for specific modals that should block global hotkeys
    return activeScopes.some(
      scope =>
        scope === 'tool-result-modal' || // Tool result modal (opened with 'i')
        scope === 'fork-view-modal' || // Fork view modal
        scope === 'dangerously-skip-permissions-dialog', // Permissions dialog
    )
  }

  return {
    handleKeyDown: (e: KeyboardEvent) => {
      // C - Create new draft session directly
      // Don't trigger if a modal is already open
      if (e.key === 'c' && !e.metaKey && !e.ctrlKey && !isTypingInInput()) {
        if (!isModalScopeActive()) {
          e.preventDefault()
          // Create draft session and navigate directly
          ;(async () => {
            try {
              const response = await daemonClient.launchSession({
                query: '', // Empty initial query for draft
                working_dir: getLastWorkingDir() || '~/',
                draft: true, // Create as draft
              })

              // Refresh sessions to include the new draft
              await refreshSessions()

              // Navigate directly to SessionDetail
              window.location.hash = `#/sessions/${response.sessionId}`
            } catch (error) {
              logger.error('Failed to create draft session:', error)
            }
          })()
          return
        }
      }

      // G+S - Go to sessions
      if (e.key === 'g' && !e.metaKey && !e.ctrlKey && !isTypingInInput() && !isModalScopeActive()) {
        e.preventDefault()
        // Listen for 's' key for navigation
        const handleSKey = (evt: KeyboardEvent) => {
          if (evt.key === 's') {
            evt.preventDefault()
            // Navigate to sessions view
            window.location.hash = '#/'
            window.removeEventListener('keydown', handleSKey)
          }
        }
        window.addEventListener('keydown', handleSKey)
        setTimeout(() => window.removeEventListener('keydown', handleSKey), 2000)
      }
    },
  }
}
