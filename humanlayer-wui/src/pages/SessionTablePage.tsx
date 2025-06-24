import { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useStore } from '@/AppStore'
import SessionTable from '@/components/internal/SessionTable'
import { SessionTableSearch } from '@/components/SessionTableSearch'
import { useSessionFilter } from '@/hooks/useSessionFilter'
import { SessionStatus } from '@/lib/daemon/types'
import { useHotkeys } from 'react-hotkeys-hook'

// Status values to cycle through with Tab
const STATUS_CYCLE = [
  '', // No filter
  `status:${SessionStatus.Running}`,
  `status:${SessionStatus.WaitingInput}`,
  `status:${SessionStatus.Completed}`,
  `status:${SessionStatus.Failed}`,
  `status:${SessionStatus.Starting}`,
  `status:${SessionStatus.Completing}`,
]

export function SessionTablePage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const tableRef = useRef<HTMLDivElement>(null)

  // Initialize search from URL params
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get('q') || '')

  const sessions = useStore(state => state.sessions)
  const focusedSession = useStore(state => state.focusedSession)
  const setFocusedSession = useStore(state => state.setFocusedSession)

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
    searchFields: ['query'], // Only search in query field for the table
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

  // Handle Tab key to cycle through status filters
  useHotkeys(
    'tab',
    e => {
      e.preventDefault()
      const currentStatusIndex = STATUS_CYCLE.findIndex(status => {
        if (!status && !statusFilter) return true
        return status === `status:${statusFilter}`
      })
      const nextIndex = (currentStatusIndex + 1) % STATUS_CYCLE.length
      setSearchQuery(STATUS_CYCLE[nextIndex])
    },
    { enableOnFormTags: false },
  )

  // Handle Shift+Tab to cycle backwards through status filters
  useHotkeys(
    'shift+tab',
    e => {
      e.preventDefault()
      const currentStatusIndex = STATUS_CYCLE.findIndex(status => {
        if (!status && !statusFilter) return true
        return status === `status:${statusFilter}`
      })
      const prevIndex = currentStatusIndex <= 0 ? STATUS_CYCLE.length - 1 : currentStatusIndex - 1
      setSearchQuery(STATUS_CYCLE[prevIndex])
    },
    { enableOnFormTags: false },
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
