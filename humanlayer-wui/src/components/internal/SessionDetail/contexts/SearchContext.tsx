import { createContext, useContext, useState, useCallback, ReactNode } from 'react'

interface SearchMatch {
  elementId: string
  text: string
  index: number
}

interface SearchContextType {
  isSearchOpen: boolean
  searchQuery: string
  matches: SearchMatch[]
  currentMatchIndex: number
  didWrapAround: boolean
  openSearch: () => void
  closeSearch: () => void
  setSearchQuery: (query: string) => void
  setMatches: (matches: SearchMatch[]) => void
  jumpToNext: () => void
  jumpToPrevious: () => void
}

const SearchContext = createContext<SearchContextType | null>(null)

export function SearchProvider({ children }: { children: ReactNode }) {
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [matches, setMatches] = useState<SearchMatch[]>([])
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0)
  const [didWrapAround, setDidWrapAround] = useState(false)

  const openSearch = useCallback(() => {
    setIsSearchOpen(true)
  }, [])

  const closeSearch = useCallback(() => {
    setIsSearchOpen(false)
    setSearchQuery('')
    setMatches([])
    setCurrentMatchIndex(0)
    setDidWrapAround(false)
  }, [])

  const jumpToNext = useCallback(() => {
    if (matches.length === 0) return
    setCurrentMatchIndex(prev => {
      const next = (prev + 1) % matches.length
      // Detect wrap-around
      if (next === 0 && prev !== 0) {
        setDidWrapAround(true)
        setTimeout(() => setDidWrapAround(false), 1000)
      }
      return next
    })
  }, [matches.length])

  const jumpToPrevious = useCallback(() => {
    if (matches.length === 0) return
    setCurrentMatchIndex(prev => {
      const next = (prev - 1 + matches.length) % matches.length
      // Detect wrap-around
      if (next === matches.length - 1 && prev !== matches.length - 1) {
        setDidWrapAround(true)
        setTimeout(() => setDidWrapAround(false), 1000)
      }
      return next
    })
  }, [matches.length])

  return (
    <SearchContext.Provider
      value={{
        isSearchOpen,
        searchQuery,
        matches,
        currentMatchIndex,
        didWrapAround,
        openSearch,
        closeSearch,
        setSearchQuery,
        setMatches,
        jumpToNext,
        jumpToPrevious,
      }}
    >
      {children}
    </SearchContext.Provider>
  )
}

export function useSearch() {
  const context = useContext(SearchContext)
  if (!context) {
    throw new Error('useSearch must be used within SearchProvider')
  }
  return context
}
