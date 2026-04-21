import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { useStore } from '@/AppStore'

export function ConversationSearchBar() {
  const isOpen = useStore(s => s.conversationSearch.isOpen)
  const query = useStore(s => s.conversationSearch.query)
  const currentMatchIndex = useStore(s => s.conversationSearch.currentMatchIndex)
  const matchCount = useStore(s => s.conversationSearch.matchCount)
  const setConversationSearchQuery = useStore(s => s.setConversationSearchQuery)
  const cycleConversationSearchMatch = useStore(s => s.cycleConversationSearchMatch)
  const closeConversationSearch = useStore(s => s.closeConversationSearch)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isOpen])

  if (!isOpen) return null

  const matchDisplay = query
    ? `${matchCount > 0 ? currentMatchIndex + 1 : 0}/${matchCount}`
    : ''

  return (
    <div className="flex items-center gap-1.5">
      <span className="font-mono text-xs text-muted-foreground/60">/</span>
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={e => setConversationSearchQuery(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            cycleConversationSearchMatch('next')
          } else if (e.key === 'Enter' && e.shiftKey) {
            e.preventDefault()
            cycleConversationSearchMatch('prev')
          } else if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            inputRef.current?.blur()
          }
        }}
        placeholder="search..."
        className="bg-transparent border-none outline-none text-xs font-mono w-32 text-foreground placeholder:text-muted-foreground/40"
        autoComplete="off"
        spellCheck={false}
      />
      {query && (
        <span className="text-xs font-mono text-muted-foreground/60 tabular-nums">
          {matchDisplay}
        </span>
      )}
      <button
        onClick={closeConversationSearch}
        className="text-muted-foreground/40 hover:text-muted-foreground transition-colors"
        tabIndex={-1}
        aria-label="Close search"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  )
}
