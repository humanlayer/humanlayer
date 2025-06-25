import { useEffect, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useSessionLauncher } from '@/hooks/useSessionLauncher'
import { useStore } from '@/AppStore'
import { highlightMatches, type FuzzyMatch } from '@/lib/fuzzy-search'
import { cn } from '@/lib/utils'
import { useSessionFilter } from '@/hooks/useSessionFilter'

interface MenuOption {
  id: string
  label: string
  description?: string
  action: () => void
  sessionId?: string
}

export default function CommandPaletteMenu() {
  const { createNewSession, openSessionById, selectedMenuIndex, setSelectedMenuIndex, mode } =
    useSessionLauncher()

  const [searchQuery, setSearchQuery] = useState('')

  // Get sessions from the main app store
  const sessions = useStore(state => state.sessions)

  // Use the shared session filter hook
  const { filteredSessions, statusFilter, searchText, matchedSessions } = useSessionFilter({
    sessions,
    query: searchQuery,
    searchFields: ['summary', 'model'], // Search in both summary and model fields for the modal
  })

  // Build base menu options
  const baseOptions: MenuOption[] = [
    {
      id: 'create-session',
      label: 'Create Session',
      description: 'Start a new session with AI assistance',
      action: createNewSession,
    },
  ]

  // Command mode: Only Create Session
  // Search mode: Use filtered sessions but limit display to 5
  const sessionOptions: MenuOption[] =
    mode === 'search'
      ? filteredSessions.slice(0, 5).map(session => ({
          id: `open-${session.id}`,
          label:
            session.summary || `${session.query.slice(0, 40)}${session.query.length > 40 ? '...' : ''}`,
          description: `${session.status} • ${session.model || 'Unknown model'}`,
          action: () => openSessionById(session.id),
          sessionId: session.id, // Store for match lookup
        }))
      : [] // No sessions in command mode

  // Combine options based on mode
  const menuOptions: MenuOption[] =
    mode === 'command'
      ? baseOptions // Command: Only Create Session
      : sessionOptions // Search: Only sessions (no Create Session), already limited to 5

  // Keyboard navigation
  useHotkeys(
    'up, k',
    () => {
      setSelectedMenuIndex(selectedMenuIndex > 0 ? selectedMenuIndex - 1 : menuOptions.length - 1)
    },
    { enabled: true },
  )

  useHotkeys(
    'down, j',
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
            <span
              key={i}
              className={
                segment.highlighted ? 'bg-yellow-200/80 dark:bg-yellow-900/60 font-medium' : ''
              }
            >
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
      {/* Search input for search mode */}
      {mode === 'search' && (
        <input
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
          placeholder="Search sessions..."
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
              'p-2 rounded cursor-pointer transition-all duration-150',
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
            <div className="text-sm font-medium truncate">
              {matchData
                ? renderHighlightedText(option.label, matchData.matches, 'label')
                : option.label}
            </div>
            {option.description && (
              <div
                className={cn(
                  'text-xs mt-0.5 truncate',
                  index === selectedMenuIndex ? 'text-primary-foreground/70' : 'text-muted-foreground',
                )}
              >
                {matchData
                  ? renderHighlightedText(option.description, matchData.matches, 'description')
                  : option.description}
              </div>
            )}
          </div>
        )
      })}

      {menuOptions.length === 0 && mode === 'search' && (
        <div className="text-xs text-muted-foreground text-center py-4">No sessions found</div>
      )}

      <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t border-border/30">
        <div className="flex items-center space-x-3">
          <span>↑↓ j/k Navigate</span>
          <span>↵ Select</span>
        </div>
        <span>ESC Close</span>
      </div>
    </div>
  )
}
