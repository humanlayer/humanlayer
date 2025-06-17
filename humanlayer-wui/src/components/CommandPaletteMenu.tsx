import { useEffect, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useSessionLauncher } from '@/hooks/useSessionLauncher'
import { useStore } from '@/App'
import { fuzzySearch, highlightMatches, type FuzzyMatch } from '@/lib/fuzzy-search'
import { cn } from '@/lib/utils'

interface MenuOption {
  id: string
  label: string
  description?: string
  action: () => void
}


export default function CommandPaletteMenu() {
  const { createNewSession, openSessionById, selectedMenuIndex, setSelectedMenuIndex, mode } =
    useSessionLauncher()
  
  const [searchQuery, setSearchQuery] = useState('')

  // Get sessions from the main app store
  const sessions = useStore(state => state.sessions)

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
  // Search mode: All sessions (for fuzzy search) but limit display to 5
  const sessionOptions: MenuOption[] = mode === 'search' 
    ? sessions.map(session => ({
        id: `open-${session.id}`,
        label: `${session.query.slice(0, 40)}${session.query.length > 40 ? '...' : ''}`,
        description: `${session.status} • ${session.model || 'Unknown model'}`,
        action: () => openSessionById(session.id),
      }))
    : [] // No sessions in command mode

  // Apply fuzzy search if in search mode and there's a query
  const filteredSessions = searchQuery && mode === 'search' 
    ? fuzzySearch(sessionOptions, searchQuery, {
        keys: ['label', 'description'],
        threshold: 0.1,
        includeMatches: true,
      })
    : sessionOptions.map(session => ({ item: session, matches: [], score: 1, indices: [] }))

  // Combine options based on mode
  const menuOptions: MenuOption[] = mode === 'command' 
    ? baseOptions  // Command: Only Create Session
    : filteredSessions.slice(0, 5).map(result => result.item)  // Search: Only sessions (no Create Session), limit to 5

  // Keyboard navigation
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
    if (match && match.indices && searchQuery) {
      const segments = highlightMatches(text, match.indices)
      return (
        <>
          {segments.map((segment, i) => (
            <span
              key={i}
              className={segment.highlighted ? 'bg-yellow-200/80 dark:bg-yellow-900/60 font-medium' : ''}
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
        </div>
      )}

      {menuOptions.map((option, index) => {
        // Find the corresponding match data for highlighting
        const matchData = mode === 'search' && searchQuery 
          ? filteredSessions.find(result => result.item.id === option.id)
          : null

        return (
          <div
            key={option.id}
            className={cn(
              'p-2 rounded cursor-pointer transition-all duration-150',
              index === selectedMenuIndex
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted/30 hover:bg-muted/60'
            )}
            onClick={() => {
              setSelectedMenuIndex(index)
              option.action()
            }}
            onMouseEnter={() => setSelectedMenuIndex(index)}
          >
            <div className="text-sm font-medium truncate">
              {matchData ? renderHighlightedText(option.label, matchData.matches, 'label') : option.label}
            </div>
            {option.description && (
              <div
                className={cn(
                  'text-xs mt-0.5 truncate',
                  index === selectedMenuIndex ? 'text-primary-foreground/70' : 'text-muted-foreground'
                )}
              >
                {matchData ? renderHighlightedText(option.description, matchData.matches, 'description') : option.description}
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
          <span>↑↓ Navigate</span>
          <span>↵ Select</span>
        </div>
        <span>ESC Close</span>
      </div>
    </div>
  )
}
