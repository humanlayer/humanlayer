import { useEffect, useRef, useState, useCallback } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { X, ChevronUp, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useSearch } from '../contexts/SearchContext'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { cn } from '@/lib/utils'

export function SearchBar() {
  const {
    isSearchOpen,
    searchQuery,
    matches,
    currentMatchIndex,
    didWrapAround,
    closeSearch,
    setSearchQuery,
    jumpToNext,
    jumpToPrevious,
  } = useSearch()

  const inputRef = useRef<HTMLInputElement>(null)
  const [isNavigating, setIsNavigating] = useState(false)

  const handleJumpToNext = useCallback(() => {
    setIsNavigating(true)
    jumpToNext()
    setTimeout(() => setIsNavigating(false), 300)
  }, [jumpToNext])

  const handleJumpToPrevious = useCallback(() => {
    setIsNavigating(true)
    jumpToPrevious()
    setTimeout(() => setIsNavigating(false), 300)
  }, [jumpToPrevious])

  // Focus input when search opens
  useEffect(() => {
    if (isSearchOpen && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isSearchOpen])

  // Keyboard shortcuts for navigation (when search is open)
  useHotkeys('ctrl+g, meta+g', handleJumpToNext, {
    enabled: isSearchOpen && matches.length > 0,
    preventDefault: true,
    scopes: [HOTKEY_SCOPES.SESSION_DETAIL],
  })

  useHotkeys('ctrl+shift+g, meta+shift+g', handleJumpToPrevious, {
    enabled: isSearchOpen && matches.length > 0,
    preventDefault: true,
    scopes: [HOTKEY_SCOPES.SESSION_DETAIL],
  })

  useHotkeys(
    'escape',
    () => {
      closeSearch()
    },
    {
      enabled: isSearchOpen,
      preventDefault: true,
      enableOnFormTags: true,
      scopes: [HOTKEY_SCOPES.SESSION_DETAIL],
    },
  )

  if (!isSearchOpen) return null

  return (
    <div
      className={cn(
        'fixed top-0 left-0 right-0 z-50',
        'bg-[var(--terminal-bg-alt)] border-b border-[var(--terminal-border)]',
        'shadow-lg',
      )}
    >
      <div className="flex items-center gap-2 px-4 py-2 max-w-4xl mx-auto">
        {/* Search input */}
        <Input
          ref={inputRef}
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search in conversation..."
          className={cn(
            'flex-1 h-7 text-xs',
            'bg-[var(--terminal-bg)] border-[var(--terminal-border)]',
            'placeholder:text-[var(--terminal-fg-dim)]',
            'focus-visible:border-[var(--terminal-accent)]',
          )}
        />

        {/* Match counter */}
        <div
          className={cn(
            'text-xs text-[var(--terminal-fg-dim)] font-mono whitespace-nowrap min-w-[80px]',
            isNavigating && 'text-[var(--terminal-accent)] animate-pulse',
          )}
        >
          {matches.length > 0 ? (
            <span>
              {currentMatchIndex + 1} / {matches.length}
            </span>
          ) : searchQuery ? (
            <span className="text-[var(--terminal-warning)]">No matches</span>
          ) : null}
        </div>

        {/* Wrap-around indicator */}
        {didWrapAround && (
          <span className="text-xs text-[var(--terminal-accent)] font-mono animate-pulse">
            (wrapped)
          </span>
        )}

        {/* Navigation buttons */}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleJumpToPrevious}
            disabled={matches.length === 0}
            className="h-7 w-7 p-0"
            title="Previous match (Ctrl+Shift+G)"
          >
            <ChevronUp className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleJumpToNext}
            disabled={matches.length === 0}
            className="h-7 w-7 p-0"
            title="Next match (Ctrl+G)"
          >
            <ChevronDown className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={closeSearch}
            className="h-7 w-7 p-0"
            title="Close (Esc)"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </div>
  )
}
