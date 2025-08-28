import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useStore } from '@/AppStore'
import { ViewMode } from '@/lib/daemon/types'
import SessionTable, { SessionTableHotkeysScope } from '@/components/SessionTable/SessionTable'
import { SessionTableSearch } from '@/components/SessionTableSearch'
import { useSessionFilter } from '@/hooks/useSessionFilter'
import { useHotkeys } from 'react-hotkeys-hook'
import { useSessionLauncher } from '@/hooks/useSessionLauncher'
import { Inbox, Archive } from 'lucide-react'
import { TIMING } from '@/lib/constants'

export function SessionTablePage() {
  const { isOpen: isSessionLauncherOpen, open: openSessionLauncher } = useSessionLauncher()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const tableRef = useRef<HTMLDivElement>(null)

  // Initialize search from URL params
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get('q') || '')

  // Focus source tracking
  const [, setFocusSource] = useState<'mouse' | 'keyboard' | null>(null)

  // Keyboard navigation protection - inline implementation
  const [isKeyboardNavigating, setIsKeyboardNavigating] = useState(false)
  const keyboardTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const startKeyboardNavigation = useCallback(() => {
    setIsKeyboardNavigating(true)
    if (keyboardTimeoutRef.current) {
      clearTimeout(keyboardTimeoutRef.current)
    }
    keyboardTimeoutRef.current = setTimeout(() => {
      setIsKeyboardNavigating(false)
    }, TIMING.DEBOUNCE_DELAY)
  }, [])

  const shouldIgnoreMouseEvent = useCallback((): boolean => {
    return isKeyboardNavigating
  }, [isKeyboardNavigating])

  const sessions = useStore(state => state.sessions)
  const selectedSessions = useStore(state => state.selectedSessions)
  const clearSelection = useStore(state => state.clearSelection)
  const focusedSession = useStore(state => state.focusedSession)
  const setFocusedSession = useStore(state => state.setFocusedSession)
  const viewMode = useStore(state => state.viewMode)
  const setViewMode = useStore(state => state.setViewMode)

  // Update URL when search changes
  useEffect(() => {
    if (searchQuery) {
      setSearchParams({ q: searchQuery })
    } else {
      setSearchParams({})
    }
  }, [searchQuery, setSearchParams])

  // Use the shared session filter hook
  const { filteredSessions, statusFilter, searchText, matchedSessions } = useSessionFilter({
    sessions,
    query: searchQuery,
    searchFields: ['summary'], // Only search in summary field for the table
  })

  const handleActivateSession = (session: any) => {
    navigate(`/sessions/${session.id}`)
  }

  // Custom navigation functions that work with filtered sessions
  const focusNextSession = () => {
    if (filteredSessions.length === 0) return

    startKeyboardNavigation()

    const currentIndex = focusedSession
      ? filteredSessions.findIndex(s => s.id === focusedSession.id)
      : -1

    // If no session is focused or we're at the last session, focus the first session
    if (currentIndex === -1 || currentIndex === filteredSessions.length - 1) {
      setFocusedSession(filteredSessions[0])
    } else {
      // Focus the next session
      setFocusedSession(filteredSessions[currentIndex + 1])
    }
    setFocusSource('keyboard')
  }

  const focusPreviousSession = () => {
    if (filteredSessions.length === 0) return

    startKeyboardNavigation()

    const currentIndex = focusedSession
      ? filteredSessions.findIndex(s => s.id === focusedSession.id)
      : -1

    // If no session is focused or we're at the first session, focus the last session
    if (currentIndex === -1 || currentIndex === 0) {
      setFocusedSession(filteredSessions[filteredSessions.length - 1])
    } else {
      // Focus the previous session
      setFocusedSession(filteredSessions[currentIndex - 1])
    }
    setFocusSource('keyboard')
  }

  // Handle Tab key to toggle between normal and archived views
  useHotkeys(
    'tab',
    e => {
      e.preventDefault()
      setViewMode(viewMode === ViewMode.Normal ? ViewMode.Archived : ViewMode.Normal)
      // Clear search when switching views
      setSearchQuery('')
    },
    { enableOnFormTags: false, scopes: SessionTableHotkeysScope, enabled: !isSessionLauncherOpen },
  )

  // Handle Shift+Tab to trigger auto-accept for selected sessions
  useHotkeys(
    'shift+tab',
    async e => {
      e.preventDefault()

      // Find sessions to apply auto-accept to
      let sessionsToUpdate: string[] = []

      if (selectedSessions.size > 0) {
        // If sessions are selected, use those
        sessionsToUpdate = Array.from(selectedSessions)
      } else if (focusedSession) {
        // Otherwise, use the focused session
        sessionsToUpdate = [focusedSession.id]
      }

      if (sessionsToUpdate.length === 0) return

      try {
        // Get the sessions to check their status
        const sessionsData = sessionsToUpdate
          .map(id => sessions.find(s => s.id === id))
          .filter(Boolean) as any[]

        // Check if all selected sessions have the same auto-accept status
        const autoAcceptStatuses = sessionsData.map(s => s.autoAcceptEdits)
        const allSameStatus = autoAcceptStatuses.every(status => status === autoAcceptStatuses[0])

        // Toggle the auto-accept status (if all true, turn off; otherwise turn on)
        const newAutoAcceptStatus = allSameStatus ? !autoAcceptStatuses[0] : true

        // Call the bulk update method
        await useStore.getState().bulkSetAutoAcceptEdits(sessionsToUpdate, newAutoAcceptStatus)

        // Show success notification
        const action = newAutoAcceptStatus ? 'enabled' : 'disabled'
        const sessionText =
          sessionsToUpdate.length === 1 ? 'session' : `${sessionsToUpdate.length} sessions`

        // Use toast from sonner
        const { toast } = await import('sonner')
        toast.success(`Auto-accept edits ${action} for ${sessionText}`, {
          duration: TIMING.NOTIFICATION_DURATION,
        })
      } catch (error) {
        const { toast } = await import('sonner')
        toast.error('Failed to update auto-accept settings', {
          description: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    },
    { enableOnFormTags: false, scopes: SessionTableHotkeysScope, enabled: !isSessionLauncherOpen },
    [selectedSessions, focusedSession, sessions],
  )

  // Handle 'gg' to jump to top of list (vim-style)
  useHotkeys(
    'g>g',
    () => {
      startKeyboardNavigation()
      setFocusSource('keyboard')

      // Find the main scrollable container (from Layout)
      const container = document.querySelector('[data-main-scroll-container]')
      if (container) {
        container.scrollTop = 0
      }
      // Also focus the first session
      if (filteredSessions.length > 0) {
        setFocusedSession(filteredSessions[0])
      }
    },
    {
      enableOnFormTags: false,
      scopes: SessionTableHotkeysScope,
      enabled: !isSessionLauncherOpen,
      preventDefault: true,
    },
  )

  // Handle 'shift+g' to jump to bottom of list (vim-style)
  useHotkeys(
    'shift+g',
    () => {
      startKeyboardNavigation()
      setFocusSource('keyboard')

      // Find the main scrollable container (from Layout)
      const container = document.querySelector('[data-main-scroll-container]')
      if (container) {
        container.scrollTop = container.scrollHeight
      }
      // Also focus the last session
      if (filteredSessions.length > 0) {
        setFocusedSession(filteredSessions[filteredSessions.length - 1])
      }
    },
    {
      enableOnFormTags: false,
      scopes: SessionTableHotkeysScope,
      enabled: !isSessionLauncherOpen,
      preventDefault: true,
    },
  )

  // Handle ESC to go back to normal view from archived
  useHotkeys(
    'escape',
    () => {
      if (selectedSessions.size > 0) {
        clearSelection()
        return null
      }

      if (viewMode === ViewMode.Archived) {
        setViewMode(ViewMode.Normal)
      }
    },
    {
      enableOnFormTags: false,
      scopes: SessionTableHotkeysScope,
      enabled: !isSessionLauncherOpen,
      preventDefault: true,
    },
    [selectedSessions],
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="sticky top-0 z-10 bg-background pb-4">
        <SessionTableSearch
          value={searchQuery}
          onChange={setSearchQuery}
          statusFilter={statusFilter}
          placeholder="Search sessions or filter by status:..."
        />
      </div>

      <div ref={tableRef} tabIndex={-1} className="focus:outline-none">
        <SessionTable
          sessions={filteredSessions}
          handleFocusSession={session => {
            if (!shouldIgnoreMouseEvent()) {
              setFocusedSession(session)
              setFocusSource('mouse')
            }
          }}
          handleBlurSession={() => {
            if (!shouldIgnoreMouseEvent()) {
              setFocusedSession(null)
              setFocusSource(null)
            }
          }}
          handleActivateSession={handleActivateSession}
          focusedSession={focusedSession}
          handleFocusNextSession={focusNextSession}
          handleFocusPreviousSession={focusPreviousSession}
          searchText={searchText}
          matchedSessions={matchedSessions}
          emptyState={
            viewMode === ViewMode.Archived
              ? {
                  icon: Archive,
                  title: 'No archived sessions',
                  message:
                    'Sessions you archive will appear here. Press ESC or click below to go back.',
                  action: {
                    label: 'View all sessions',
                    onClick: () => setViewMode(ViewMode.Normal),
                  },
                }
              : {
                  icon: Inbox,
                  title: 'No sessions yet',
                  message: 'Create a new session by pressing "c" or clicking below.',
                  action: {
                    label: 'Create new session',
                    onClick: () => {
                      openSessionLauncher('command')
                    },
                  },
                }
          }
        />
      </div>
    </div>
  )
}
