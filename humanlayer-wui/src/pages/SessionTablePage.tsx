import { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useStore } from '@/stores/appStore'
import { ViewMode } from '@/lib/daemon/types'
import SessionTable, { SessionTableHotkeysScope } from '@/components/internal/SessionTable'
import VirtualizedSessionTable from '@/components/internal/VirtualizedSessionTable'
import InfiniteScrollSessionTable from '@/components/internal/InfiniteScrollSessionTable'
import { SessionTableSearch } from '@/components/SessionTableSearch'
import { usePaginatedSessions } from '@/hooks/usePaginatedSessions'
import { useSessionFilter } from '@/hooks/useSessionFilter'
import { useHotkeys } from 'react-hotkeys-hook'
import { useSessionLauncher, useKeyboardNavigationProtection } from '@/hooks'
import { Inbox, Archive } from 'lucide-react'

export function SessionTablePage() {
  const { isOpen: isSessionLauncherOpen, open: openSessionLauncher } = useSessionLauncher()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const tableRef = useRef<HTMLDivElement>(null)

  // Initialize search from URL params
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get('q') || '')

  // Focus source tracking
  const [, setFocusSource] = useState<'mouse' | 'keyboard' | null>(null)

  // Keyboard navigation protection
  const { shouldIgnoreMouseEvent, startKeyboardNavigation } = useKeyboardNavigationProtection()

  const sessions = useStore(state => state.sessions)
  const focusedSession = useStore(state => state.focusedSession)
  const setFocusedSession = useStore(state => state.setFocusedSession)
  const viewMode = useStore(state => state.viewMode)
  const setViewMode = useStore(state => state.setViewMode)

  // Use paginated sessions for very large lists (over 500 sessions)
  const shouldUsePagination = sessions.length > 500
  const paginatedSessions = usePaginatedSessions({
    viewMode,
    pageSize: 100,
  })

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
    sessions: shouldUsePagination ? paginatedSessions.sessions : sessions,
    query: searchQuery,
    searchFields: ['summary'], // Only search in summary field for the table
  })

  const handleActivateSession = (session: { id: string }) => {
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
    setFocusSource('keyboard')
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

  // Handle Shift+Tab to toggle backwards (same effect for only 2 modes)
  useHotkeys(
    'shift+tab',
    e => {
      e.preventDefault()
      setViewMode(viewMode === ViewMode.Normal ? ViewMode.Archived : ViewMode.Normal)
      // Clear search when switching views
      setSearchQuery('')
    },
    { enableOnFormTags: false, scopes: SessionTableHotkeysScope, enabled: !isSessionLauncherOpen },
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
      if (viewMode === ViewMode.Archived) {
        setViewMode(ViewMode.Normal)
      }
    },
    {
      enableOnFormTags: false,
      scopes: SessionTableHotkeysScope,
      enabled: !isSessionLauncherOpen && viewMode === ViewMode.Archived,
      preventDefault: true,
    },
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
        {/* Use infinite scroll table for very large lists with server pagination */}
        {shouldUsePagination ? (
          <InfiniteScrollSessionTable
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
            loading={paginatedSessions.loading}
            loadingMore={paginatedSessions.loadingMore}
            hasMore={paginatedSessions.hasMore}
            onLoadMore={paginatedSessions.loadMore}
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
        ) : filteredSessions.length > 100 ? (
          <VirtualizedSessionTable
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
        ) : (
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
        )}
      </div>
    </div>
  )
}
