import { useEffect, useRef } from 'react'
import Highlighter from 'react-highlight-words'
import { useSearch } from '../contexts/SearchContext'
import { cn } from '@/lib/utils'

interface HighlightableTextProps {
  text: string
  className?: string
  elementId: string
}

export function HighlightableText({ text, className, elementId }: HighlightableTextProps) {
  const { searchQuery, currentMatchIndex, matches } = useSearch()
  const containerRef = useRef<HTMLSpanElement>(null)

  // Track which matches belong to this element
  useEffect(() => {
    if (!containerRef.current || !searchQuery) return

    // Update data attributes for CSS targeting
    const markElements = containerRef.current.querySelectorAll('mark[data-search-match]')
    markElements.forEach(mark => {
      const globalIndex = parseInt(mark.getAttribute('data-match-index') || '0')
      if (globalIndex === currentMatchIndex) {
        mark.classList.add('search-match-current')
      } else {
        mark.classList.remove('search-match-current')
      }
    })
  }, [currentMatchIndex, searchQuery])

  if (!searchQuery || !text) {
    return <span className={className}>{text}</span>
  }

  let matchIndexOffset = 0
  // Calculate the global match index offset for this element
  for (const match of matches) {
    if (match.elementId === elementId) break
    matchIndexOffset++
  }

  return (
    <span ref={containerRef} className={className}>
      <Highlighter
        searchWords={[searchQuery]}
        textToHighlight={text}
        autoEscape={true}
        caseSensitive={false}
        highlightTag={({ children, highlightIndex }) => {
          const globalIndex = matchIndexOffset + highlightIndex
          const isCurrentMatch = globalIndex === currentMatchIndex

          return (
            <mark
              data-search-match={`${elementId}-${highlightIndex}`}
              data-match-index={globalIndex}
              className={cn('search-match', isCurrentMatch && 'search-match-current')}
            >
              {children}
            </mark>
          )
        }}
      />
    </span>
  )
}
