import { useEffect } from 'react'
import { useSearch } from '../contexts/SearchContext'

export function useSearchMatching() {
  const { searchQuery, setMatches, currentMatchIndex } = useSearch()

  useEffect(() => {
    if (!searchQuery) {
      setMatches([])
      return
    }

    // Debounce search
    const timeoutId = setTimeout(() => {
      // Find all elements with search matches
      const matchElements = document.querySelectorAll('[data-search-match]')
      const newMatches = Array.from(matchElements).map((el, index) => {
        const elementId = el.getAttribute('data-search-match') || ''
        return {
          elementId,
          text: el.textContent || '',
          index,
        }
      })

      setMatches(newMatches)

      // Scroll to first match
      if (newMatches.length > 0 && matchElements[0]) {
        matchElements[0].scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        })
      }
    }, 100)

    return () => clearTimeout(timeoutId)
  }, [searchQuery, setMatches])

  // Scroll to current match when index changes
  useEffect(() => {
    const matchElements = document.querySelectorAll('[data-search-match]')
    if (matchElements[currentMatchIndex]) {
      matchElements[currentMatchIndex].scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      })
    }
  }, [currentMatchIndex])
}
