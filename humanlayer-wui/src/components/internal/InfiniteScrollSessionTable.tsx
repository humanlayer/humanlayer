import { useEffect, useRef } from 'react'
import { SessionInfo } from '@/lib/daemon/types'
import VirtualizedSessionTable from './VirtualizedSessionTable'
import { Loader2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

interface InfiniteScrollSessionTableProps {
  sessions: SessionInfo[]
  handleFocusSession?: (session: SessionInfo) => void
  handleBlurSession?: () => void
  handleFocusNextSession?: () => void
  handleFocusPreviousSession?: () => void
  handleActivateSession?: (session: SessionInfo) => void
  focusedSession: SessionInfo | null
  searchText?: string
  matchedSessions?: Map<string, any>
  emptyState?: {
    icon?: LucideIcon
    title: string
    message?: string
    action?: {
      label: string
      onClick: () => void
    }
  }

  // Infinite scroll props
  loading: boolean
  loadingMore: boolean
  hasMore: boolean
  onLoadMore: () => Promise<void>
}

export default function InfiniteScrollSessionTable({
  sessions,
  handleFocusSession,
  handleBlurSession,
  handleFocusNextSession,
  handleFocusPreviousSession,
  handleActivateSession,
  focusedSession,
  searchText,
  matchedSessions,
  emptyState,
  loading,
  loadingMore,
  hasMore,
  onLoadMore,
}: InfiniteScrollSessionTableProps) {
  const observerTarget = useRef<HTMLDivElement>(null)

  // Set up intersection observer for infinite scrolling
  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting && hasMore && !loadingMore && !loading) {
          onLoadMore()
        }
      },
      { threshold: 1.0 },
    )

    const currentTarget = observerTarget.current
    if (currentTarget) {
      observer.observe(currentTarget)
    }

    return () => {
      if (currentTarget) {
        observer.unobserve(currentTarget)
      }
    }
  }, [hasMore, loadingMore, loading, onLoadMore])

  if (loading && sessions.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="relative h-full">
      <VirtualizedSessionTable
        sessions={sessions}
        handleFocusSession={handleFocusSession}
        handleBlurSession={handleBlurSession}
        handleFocusNextSession={handleFocusNextSession}
        handleFocusPreviousSession={handleFocusPreviousSession}
        handleActivateSession={handleActivateSession}
        focusedSession={focusedSession}
        searchText={searchText}
        matchedSessions={matchedSessions}
        emptyState={emptyState}
      />

      {/* Loading indicator at the bottom */}
      {hasMore && (
        <div ref={observerTarget} className="flex items-center justify-center p-4">
          {loadingMore && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Loading more sessions...</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
