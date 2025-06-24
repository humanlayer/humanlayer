import React, { useState, useRef, useEffect, useMemo } from 'react'
import { cn } from '@/lib/utils'
import { fuzzySearch, highlightMatches, type FuzzyMatch } from '@/lib/fuzzy-search'

interface FuzzySearchInputProps<T> {
  items: T[]
  value: string
  onChange: (value: string) => void
  onSelect?: (item: T) => void
  placeholder?: string
  searchKeys?: string[]
  renderItem?: (item: T, matches: FuzzyMatch['matches']) => React.ReactNode
  className?: string
  maxResults?: number
  emptyMessage?: string
  disabled?: boolean
}

export default function FuzzySearchInput<T>({
  items,
  value,
  onChange,
  onSelect,
  placeholder = 'Search...',
  searchKeys = [],
  renderItem,
  className,
  maxResults = 10,
  emptyMessage = 'No results found',
  disabled = false,
}: FuzzySearchInputProps<T>) {
  const [isOpen, setIsOpen] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Perform fuzzy search
  const searchResults = useMemo(() => {
    if (!value.trim()) return []

    const results = fuzzySearch(items, value, {
      keys: searchKeys,
      threshold: 0.1,
      includeMatches: true,
    })

    return results.slice(0, maxResults)
  }, [items, value, searchKeys, maxResults])

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0)
  }, [searchResults])

  // Open dropdown when typing
  useEffect(() => {
    setIsOpen(value.length > 0 && searchResults.length > 0)
  }, [value, searchResults.length])

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen || !searchResults.length) return

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex(prev => (prev + 1) % searchResults.length)
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex(prev => (prev - 1 + searchResults.length) % searchResults.length)
          break
        case 'Enter':
          e.preventDefault()
          if (searchResults[selectedIndex] && onSelect) {
            onSelect(searchResults[selectedIndex].item)
            setIsOpen(false)
          }
          break
        case 'Escape':
          e.preventDefault()
          setIsOpen(false)
          inputRef.current?.blur()
          break
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown)
      return () => document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, searchResults, selectedIndex, onSelect])

  // Scroll selected item into view
  useEffect(() => {
    if (listRef.current && isOpen) {
      const selectedElement = listRef.current.children[selectedIndex] as HTMLElement
      selectedElement?.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex, isOpen])

  const handleItemClick = (item: T, index: number) => {
    setSelectedIndex(index)
    if (onSelect) {
      onSelect(item)
      setIsOpen(false)
    }
  }

  const defaultRenderItem = (item: T, matches: FuzzyMatch['matches']) => {
    const text = String(item)
    const match = matches[0]

    if (match && match.indices) {
      const segments = highlightMatches(text, match.indices)
      return defaultRenderHighlight(segments)
    }

    return <span>{text}</span>
  }

  const defaultRenderHighlight = (segments: Array<{ text: string; highlighted: boolean }>) => (
    <>
      {segments.map((segment, i) => (
        <span
          key={i}
          className={segment.highlighted ? 'bg-yellow-200 dark:bg-yellow-900/50 font-medium' : ''}
        >
          {segment.text}
        </span>
      ))}
    </>
  )

  return (
    <div className="relative">
      <input
        spellCheck={false}
        ref={inputRef}
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={() => value && searchResults.length > 0 && setIsOpen(true)}
        placeholder={placeholder}
        disabled={disabled}
        className={cn(
          'w-full h-10 px-3 py-2 text-sm',
          'font-mono',
          'bg-background border rounded-md',
          'transition-all duration-200',
          'placeholder:text-muted-foreground/60',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          'border-border hover:border-primary/50 focus:border-primary focus:ring-2 focus:ring-primary/20',
          className,
        )}
        autoComplete="off"
      />

      {isOpen && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />

          {/* Results dropdown */}
          <div
            ref={listRef}
            className="absolute top-full left-0 right-0 mt-1 bg-background border border-border rounded-md shadow-lg z-20 max-h-60 overflow-y-auto"
          >
            {searchResults.length > 0 ? (
              searchResults.map((result, index) => (
                <div
                  key={index}
                  className={cn(
                    'px-3 py-2 cursor-pointer transition-colors text-sm',
                    'border-b border-border/50 last:border-b-0',
                    index === selectedIndex
                      ? 'bg-primary text-primary-foreground'
                      : 'hover:bg-muted/50',
                  )}
                  onClick={() => handleItemClick(result.item, index)}
                  onMouseEnter={() => setSelectedIndex(index)}
                >
                  {renderItem
                    ? renderItem(result.item, result.matches)
                    : defaultRenderItem(result.item, result.matches)}
                </div>
              ))
            ) : (
              <div className="px-3 py-2 text-sm text-muted-foreground text-center">{emptyMessage}</div>
            )}

            {/* Footer with navigation hints */}
            {searchResults.length > 0 && (
              <div className="px-3 py-1 text-xs text-muted-foreground bg-muted/30 border-t border-border/50 flex items-center justify-between">
                <span>↑↓ Navigate</span>
                <span>↵ Select • ESC Close</span>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
