import { useEffect, useRef, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useSessionLauncher, isViewingSessionDetail } from '@/hooks/useSessionLauncher'
import { useStore } from '@/AppStore'
import { highlightMatches, type FuzzyMatch } from '@/lib/fuzzy-search'
import { cn } from '@/lib/utils'
import { useSessionFilter } from '@/hooks/useSessionFilter'
import { EmptyState } from '../internal/EmptyState'
import { Search } from 'lucide-react'
import { KeyboardShortcut } from '../HotkeyPanel'

interface MenuOption {
  id: string
  label: string
  description?: string
  action: () => void
  sessionId?: string
  hotkey?: string
}

export default function CommandPaletteMenu() {
  const { createNewSession, openSessionById, selectedMenuIndex, setSelectedMenuIndex, mode, close } =
    useSessionLauncher()

  const [searchQuery, setSearchQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Get sessions and state from the main app store
  const sessions = useStore(state => state.sessions)
  const focusedSession = useStore(state => state.focusedSession)
  const selectedSessions = useStore(state => state.selectedSessions)
  const activeSessionDetail = useStore(state => state.activeSessionDetail)
  const archiveSession = useStore(state => state.archiveSession)
  const bulkArchiveSessions = useStore(state => state.bulkArchiveSessions)

  // Use the shared session filter hook
  const { filteredSessions, statusFilter, searchText, matchedSessions } = useSessionFilter({
    sessions,
    query: searchQuery,
    searchFields: ['summary', 'model'], // Search in both summary and model fields for the modal
  })

  // Check if we're viewing a session detail
  const isSessionDetail = isViewingSessionDetail()

  // Check if we should show archive option
  const isSessionTable = !isSessionDetail && window.location.hash === '#/'
  const shouldShowArchive =
    isSessionDetail || (isSessionTable && (focusedSession || selectedSessions.size > 0))

  // Determine if we should show unarchive instead of archive
  const getArchiveLabel = (): string => {
    if (isSessionDetail && activeSessionDetail) {
      return activeSessionDetail.session.archived ? 'Unarchive' : 'Archive'
    } else if (selectedSessions.size > 0) {
      // For bulk operations, check if all selected sessions have same archive state
      const sessionIds = Array.from(selectedSessions)
      const sessionsToCheck = sessions.filter(s => sessionIds.includes(s.id))
      const allArchived = sessionsToCheck.every(s => s.archived)
      const allActive = sessionsToCheck.every(s => !s.archived)

      // If mixed state, use "Archive" as default
      if (!allArchived && !allActive) {
        return 'Archive'
      }
      return allArchived ? 'Unarchive' : 'Archive'
    } else if (focusedSession) {
      return focusedSession.archived ? 'Unarchive' : 'Archive'
    }
    return 'Archive' // Default
  }

  // Build base menu options
  const baseOptions: MenuOption[] = [
    {
      id: 'create-session',
      label: 'Create Session',
      action: createNewSession,
      hotkey: 'C',
    },
    ...(isSessionDetail && searchQuery.toLowerCase().includes('brain')
      ? [
          {
            id: 'toggle-brainrot',
            label: 'Brainrot Mode',
            action: () => {
              window.dispatchEvent(new CustomEvent('toggle-brainrot-mode'))
              close()
            },
          },
        ]
      : []),
    ...(shouldShowArchive
      ? [
          {
            id: 'archive-session',
            label: getArchiveLabel(),
            action: async () => {
              if (isSessionDetail && activeSessionDetail) {
                // Archive current session in detail view
                await archiveSession(
                  activeSessionDetail.session.id,
                  !activeSessionDetail.session.archived,
                )
                close()
              } else if (selectedSessions.size > 0) {
                // Bulk archive selected sessions
                const sessionIds = Array.from(selectedSessions)
                const sessionsToArchive = sessions.filter(s => sessionIds.includes(s.id))
                const allArchived = sessionsToArchive.every(s => s.archived)
                await bulkArchiveSessions(sessionIds, !allArchived)
                close()
              } else if (focusedSession) {
                // Archive focused session
                await archiveSession(focusedSession.id, !focusedSession.archived)
                close()
              }
            },
            hotkey: 'E',
          },
        ]
      : []),
  ]

  // Command mode: Only Create Session
  // Search mode: Use filtered sessions but limit display to 5
  const sessionOptions: MenuOption[] =
    mode === 'search'
      ? filteredSessions.slice(0, 5).map(session => ({
          id: `open-${session.id}`,
          label:
            session.summary || `${session.query.slice(0, 40)}${session.query.length > 40 ? '...' : ''}`,
          action: () => openSessionById(session.id),
          sessionId: session.id, // Store for match lookup
        }))
      : [] // No sessions in command mode

  // Filter options based on search query in command mode
  const filteredBaseOptions = searchQuery
    ? baseOptions.filter(option => option.label.toLowerCase().includes(searchQuery.toLowerCase()))
    : baseOptions

  // Combine options based on mode
  const menuOptions: MenuOption[] =
    mode === 'command'
      ? filteredBaseOptions // Command: Filtered base options
      : sessionOptions // Search: Only sessions (no Create Session), already limited to 5

  // Keyboard navigation - only arrow keys
  useHotkeys(
    'up',
    () => {
      setSelectedMenuIndex(selectedMenuIndex > 0 ? selectedMenuIndex - 1 : menuOptions.length - 1)
    },
    { enabled: true },
  )

  useHotkeys(
    'down',
    () => {
      setSelectedMenuIndex(selectedMenuIndex < menuOptions.length - 1 ? selectedMenuIndex + 1 : 0)
    },
    { enabled: true },
  )

  useHotkeys(
    'enter',
    () => {
      if (menuOptions[selectedMenuIndex]) {
        menuOptions[selectedMenuIndex].action()
      }
    },
    { enabled: true },
  )

  // Reset selection when options change
  useEffect(() => {
    if (selectedMenuIndex >= menuOptions.length) {
      setSelectedMenuIndex(0)
    }
  }, [menuOptions.length, selectedMenuIndex, setSelectedMenuIndex])

  // Render highlighted text for search results
  const renderHighlightedText = (text: string, matches: FuzzyMatch['matches'], targetKey?: string) => {
    const match = matches.find(m => m.key === targetKey)
    if (match && match.indices && searchText) {
      const segments = highlightMatches(text, match.indices)
      return (
        <>
          {segments.map((segment, i) => (
            <span key={i} className={cn(segment.highlighted && 'bg-accent/40 font-medium')}>
              {segment.text}
            </span>
          ))}
        </>
      )
    }
    return text
  }

  return (
    <div className="space-y-2">
      {/* Search input for both modes */}
      {(mode === 'search' || mode === 'command') && (
        <input
          ref={inputRef}
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          onKeyDown={e => {
            // Prevent up/down from moving cursor, let them control the list
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault()
            }
            // Enter should trigger selected option
            if (e.key === 'Enter' && menuOptions[selectedMenuIndex]) {
              e.preventDefault()
              menuOptions[selectedMenuIndex].action()
            }
          }}
          placeholder={mode === 'search' ? 'Search sessions...' : 'Search commands...'}
          className={cn(
            'w-full h-9 px-3 py-2 text-sm',
            'font-mono',
            'bg-background border rounded-md',
            'transition-all duration-200',
            'placeholder:text-muted-foreground/60',
            'border-border hover:border-primary/50 focus:border-primary focus:ring-2 focus:ring-primary/20',
          )}
          autoComplete="off"
          autoFocus
        />
      )}

      {/* Results counter for search mode - compact */}
      {mode === 'search' && (
        <div className="text-xs text-muted-foreground">
          {menuOptions.length} of {filteredSessions.length} sessions
          {statusFilter && (
            <span
              className="ml-2 px-2 py-0.5 text-accent-foreground rounded"
              style={{ backgroundColor: 'var(--terminal-accent)' }}
            >
              status: {statusFilter.toLowerCase()}
            </span>
          )}
        </div>
      )}

      {menuOptions.map((option, index) => {
        // Find the corresponding match data for highlighting
        const matchData =
          mode === 'search' && searchText && option.sessionId
            ? matchedSessions.get(option.sessionId)
            : null

        return (
          <div
            key={option.id}
            className={cn(
              'p-3 rounded cursor-pointer transition-all duration-150',
              index === selectedMenuIndex
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted/30 hover:bg-muted/60',
            )}
            onClick={() => {
              setSelectedMenuIndex(index)
              option.action()
            }}
            onMouseEnter={() => setSelectedMenuIndex(index)}
          >
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium truncate">
                {matchData
                  ? renderHighlightedText(option.label, matchData.matches, 'label')
                  : option.label}
              </div>
              {option.hotkey && <KeyboardShortcut keyString={option.hotkey} />}
            </div>
          </div>
        )
      })}

      {menuOptions.length === 0 && mode === 'search' && (
        <EmptyState
          icon={Search}
          title="No sessions found"
          message={searchQuery ? `No results for "${searchQuery}"` : 'No sessions yet'}
        />
      )}

      <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t border-border/30">
        <div className="flex items-center space-x-3">
          <span>↑↓ Navigate</span>
          <span>↵ Select</span>
        </div>
        <span>ESC Close</span>
      </div>
    </div>
  )
}
