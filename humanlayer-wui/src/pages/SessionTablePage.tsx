import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '@/AppStore'
import { ViewMode } from '@/lib/daemon/types'
import SessionTable, { SessionTableHotkeysScope } from '@/components/internal/SessionTable'
import { useHotkeys } from 'react-hotkeys-hook'
import { useKeyboardNavigationProtection, getLastWorkingDir } from '@/hooks'
import { daemonClient } from '@/lib/daemon'
import { useSessionLauncher } from '@/hooks/useSessionLauncher'
import { Inbox, Archive } from 'lucide-react'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

export function SessionTablePage() {
  const isSessionLauncherOpen = useSessionLauncher(state => state.isOpen)
  const navigate = useNavigate()
  const tableRef = useRef<HTMLDivElement>(null)

  // Focus source tracking
  const [, setFocusSource] = useState<'mouse' | 'keyboard' | null>(null)

  // Keyboard navigation protection
  const { shouldIgnoreMouseEvent, startKeyboardNavigation } = useKeyboardNavigationProtection()

  const sessions = useStore(state => state.sessions)
  const sessionCounts = useStore(state => state.sessionCounts)
  const selectedSessions = useStore(state => state.selectedSessions)
  const clearSelection = useStore(state => state.clearSelection)
  const focusedSession = useStore(state => state.focusedSession)
  const setFocusedSession = useStore(state => state.setFocusedSession)
  const setNextViewMode = useStore(state => state.setNextViewMode)
  const setPreviousViewMode = useStore(state => state.setPreviousViewMode)
  const getViewMode = useStore(state => state.getViewMode)
  const setViewMode = useStore(state => state.setViewMode)

  const viewMode = getViewMode()

  const handleActivateSession = (session: any) => {
    navigate(`/sessions/${session.id}`)
  }

  // Custom navigation functions that work with sessions
  const focusNextSession = () => {
    if (sessions.length === 0) return

    startKeyboardNavigation()

    const currentIndex = focusedSession ? sessions.findIndex(s => s.id === focusedSession.id) : -1

    // If no session is focused or we're at the last session, focus the first session
    if (currentIndex === -1 || currentIndex === sessions.length - 1) {
      setFocusedSession(sessions[0])
    } else {
      // Focus the next session
      setFocusedSession(sessions[currentIndex + 1])
    }
    setFocusSource('keyboard')
  }

  const focusPreviousSession = () => {
    if (sessions.length === 0) return

    startKeyboardNavigation()

    const currentIndex = focusedSession ? sessions.findIndex(s => s.id === focusedSession.id) : -1

    // If no session is focused or we're at the first session, focus the last session
    if (currentIndex === -1 || currentIndex === 0) {
      setFocusedSession(sessions[sessions.length - 1])
    } else {
      // Focus the previous session
      setFocusedSession(sessions[currentIndex - 1])
    }
    setFocusSource('keyboard')
  }

  // Handle Tab key to toggle between normal and archived views
  useHotkeys(
    'tab',
    e => {
      e.preventDefault()
      setNextViewMode()
    },
    { enableOnFormTags: false, scopes: SessionTableHotkeysScope, enabled: !isSessionLauncherOpen },
  )

  useHotkeys('shift+tab', e => {
    e.preventDefault()
    setPreviousViewMode()
  })

  // Handle Shift+Tab to trigger auto-accept for selected sessions
  useHotkeys(
    'alt+a',
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
          duration: 3000,
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
      if (sessions.length > 0) {
        setFocusedSession(sessions[0])
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
      if (sessions.length > 0) {
        setFocusedSession(sessions[sessions.length - 1])
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
      <nav className="sticky top-0 z-10">
        <Tabs
          className="w-[400px]"
          value={viewMode}
          onValueChange={value => setViewMode(value as ViewMode)}
        >
          <TabsList>
            <TabsTrigger value={ViewMode.Normal}>
              Sessions{sessionCounts?.normal !== undefined ? ` (${sessionCounts.normal})` : ''}
            </TabsTrigger>
            <TabsTrigger value={ViewMode.Archived}>Archived</TabsTrigger>
            <TabsTrigger value={ViewMode.Drafts}>
              Drafts{sessionCounts?.draft !== undefined ? ` (${sessionCounts.draft})` : ''}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </nav>
      <div ref={tableRef} tabIndex={-1} className="focus:outline-none">
        <SessionTable
          sessions={sessions}
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
          searchText={undefined}
          matchedSessions={undefined}
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
                    onClick: async () => {
                      // Create draft session and navigate directly
                      try {
                        const response = await daemonClient.launchSession({
                          query: '', // Empty initial query for draft
                          working_dir: getLastWorkingDir() || '~/',
                          draft: true, // Create as draft
                        })
                        // Navigate directly to SessionDetail
                        window.location.hash = `#/sessions/${response.sessionId}`
                      } catch (error) {
                        console.error('Failed to create draft session:', error)
                      }
                    },
                  },
                }
          }
        />
      </div>
    </div>
  )
}
