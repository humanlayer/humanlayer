import { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useStore } from '@/AppStore'
import SessionTable, { SessionTableHotkeysScope } from '@/components/internal/SessionTable'
import { SessionTableSearch } from '@/components/SessionTableSearch'
import { useSessionFilter } from '@/hooks/useSessionFilter'
import { useHotkeys } from 'react-hotkeys-hook'
import { useSessionLauncher } from '@/hooks'

export function SessionTablePage() {
  const { isOpen: isSessionLauncherOpen } = useSessionLauncher()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const tableRef = useRef<HTMLDivElement>(null)

  // Initialize search from URL params
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get('q') || '')

  const sessions = useStore(state => state.sessions)
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
  }

  const focusPreviousSession = () => {
    if (filteredSessions.length === 0) return

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
  }

  // Handle Tab key to toggle between normal and archived views
  useHotkeys(
    'tab',
    e => {
      e.preventDefault()
      setViewMode(viewMode === 'normal' ? 'archived' : 'normal')
      // Clear search when switching views
      setSearchQuery('')
    },
    { enableOnFormTags: false, scopes: SessionTableHotkeysScope, enabled: !isSessionLauncherOpen },
  )

  // Handle Shift+Tab to toggle backwards (same effect for only 2 modes)
  useHotkeys(
    'shift+tab',
    e => {
      e.preventDefault()
      setViewMode(viewMode === 'normal' ? 'archived' : 'normal')
      // Clear search when switching views
      setSearchQuery('')
    },
    { enableOnFormTags: false, scopes: SessionTableHotkeysScope, enabled: !isSessionLauncherOpen },
  )

  return (
    <div className="flex flex-col gap-4">
      <SessionTableSearch
        value={searchQuery}
        onChange={setSearchQuery}
        statusFilter={statusFilter}
        placeholder="Search sessions or filter by status:..."
      />

      <div ref={tableRef} tabIndex={-1} className="focus:outline-none">
        <SessionTable
          sessions={filteredSessions}
          handleFocusSession={session => setFocusedSession(session)}
          handleBlurSession={() => setFocusedSession(null)}
          handleActivateSession={handleActivateSession}
          focusedSession={focusedSession}
          handleFocusNextSession={focusNextSession}
          handleFocusPreviousSession={focusPreviousSession}
          searchText={searchText}
          matchedSessions={matchedSessions}
        />
      </div>
    </div>
  )
}
