import { SessionInfo } from '@/lib/daemon/types'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { useHotkeys, useHotkeysContext } from 'react-hotkeys-hook'
import { useEffect, useRef } from 'react'
import { CircleOff, CheckSquare, Square } from 'lucide-react'
import { getStatusTextClass } from '@/utils/component-utils'
import { formatTimestamp, formatAbsoluteTimestamp, truncatePath } from '@/utils/formatting'
import { highlightMatches } from '@/lib/fuzzy-search'
import { useSessionLauncher } from '@/hooks/useSessionLauncher'
import { cn } from '@/lib/utils'
import { useStore } from '@/AppStore'
import { toast } from 'sonner'
import { EmptyState } from './EmptyState'
import type { LucideIcon } from 'lucide-react'

interface SessionTableProps {
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
}

export const SessionTableHotkeysScope = 'session-table'

export default function SessionTable({
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
}: SessionTableProps) {
  const { isOpen: isSessionLauncherOpen } = useSessionLauncher()
  const { enableScope, disableScope } = useHotkeysContext()
  const tableRef = useRef<HTMLTableElement>(null)
  const {
    archiveSession,
    selectedSessions,
    toggleSessionSelection,
    bulkArchiveSessions,
    selectionAnchor,
    setSelectionAnchor,
    clearSelectionAnchor,
    selectRange,
    addRangeToSelection,
    isAddingToSelection,
  } = useStore()

  // Helper to render highlighted text
  const renderHighlightedText = (text: string, sessionId: string) => {
    if (!searchText || !matchedSessions) return text

    const matchData = matchedSessions.get(sessionId)
    if (!matchData) return text

    // Find matches for the summary field
    const summaryMatch = matchData.matches?.find((m: any) => m.key === 'summary')
    if (!summaryMatch || !summaryMatch.indices) return text

    const segments = highlightMatches(text, summaryMatch.indices)
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

  useEffect(() => {
    enableScope(SessionTableHotkeysScope)
    return () => {
      disableScope(SessionTableHotkeysScope)
    }
  }, [])

  // Scroll focused session into view
  useEffect(() => {
    if (focusedSession && tableRef.current) {
      const focusedRow = tableRef.current.querySelector(`[data-session-id="${focusedSession.id}"]`)
      if (focusedRow) {
        focusedRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }
    }
  }, [focusedSession])

  useHotkeys(
    'j',
    () => {
      console.log('[j] Clearing anchor, current selections:', {
        selectedSessionsSize: selectedSessions.size,
        selectedSessionIds: Array.from(selectedSessions),
      })
      clearSelectionAnchor() // Clear anchor on regular navigation
      handleFocusNextSession?.()
    },
    {
      scopes: SessionTableHotkeysScope,
      enabled: !isSessionLauncherOpen,
    },
    [clearSelectionAnchor, handleFocusNextSession, selectedSessions],
  )

  useHotkeys(
    'k',
    () => {
      clearSelectionAnchor() // Clear anchor on regular navigation
      handleFocusPreviousSession?.()
    },
    {
      scopes: SessionTableHotkeysScope,
      enabled: !isSessionLauncherOpen,
    },
    [clearSelectionAnchor, handleFocusPreviousSession],
  )

  // Bulk selection with shift+j/k
  useHotkeys(
    'shift+j',
    () => {
      if (focusedSession) {
        const currentIndex = sessions.findIndex(s => s.id === focusedSession.id)

        console.log('[shift+j] Current state:', {
          focusedSessionId: focusedSession.id,
          currentIndex,
          selectionAnchor,
          selectedSessionsSize: selectedSessions.size,
          selectedSessionIds: Array.from(selectedSessions),
          isAddingToSelection,
        })

        // Check if we should be adding to selection BEFORE setting anchor
        const shouldAddToSelection = !selectionAnchor && selectedSessions.size > 0

        // If no anchor is set, set it to current position
        if (!selectionAnchor) {
          console.log('[shift+j] Setting anchor to:', focusedSession.id)
          setSelectionAnchor(focusedSession.id)
        }

        // Move focus to next session
        if (currentIndex < sessions.length - 1) {
          const nextSession = sessions[currentIndex + 1]
          handleFocusSession?.(nextSession)

          // Use the pre-calculated flag for new sequences, or check isAddingToSelection for continuing sequences
          const shouldAdd = shouldAddToSelection || isAddingToSelection
          
          if (shouldAdd) {
            console.log('[shift+j] Adding to selection:', {
              anchor: selectionAnchor || focusedSession.id,
              target: nextSession.id,
            })
            // Continue adding to existing selections
            addRangeToSelection(selectionAnchor || focusedSession.id, nextSession.id)
          } else {
            console.log('[shift+j] Replacing selection:', {
              anchor: selectionAnchor || focusedSession.id,
              target: nextSession.id,
            })
            // Replace selections with new range
            selectRange(selectionAnchor || focusedSession.id, nextSession.id)
          }
        }
      }
    },
    {
      scopes: SessionTableHotkeysScope,
      enabled: !isSessionLauncherOpen,
      preventDefault: true,
    },
    [
      focusedSession,
      sessions,
      selectionAnchor,
      setSelectionAnchor,
      selectRange,
      addRangeToSelection,
      isAddingToSelection,
      handleFocusSession,
    ],
  )

  useHotkeys(
    'shift+k',
    () => {
      if (focusedSession) {
        const currentIndex = sessions.findIndex(s => s.id === focusedSession.id)

        console.log('[shift+k] Current state:', {
          focusedSessionId: focusedSession.id,
          currentIndex,
          selectionAnchor,
          selectedSessionsSize: selectedSessions.size,
          selectedSessionIds: Array.from(selectedSessions),
          isAddingToSelection,
        })

        // Check if we should be adding to selection BEFORE setting anchor
        const shouldAddToSelection = !selectionAnchor && selectedSessions.size > 0

        // If no anchor is set, set it to current position
        if (!selectionAnchor) {
          console.log('[shift+k] Setting anchor to:', focusedSession.id)
          setSelectionAnchor(focusedSession.id)
        }

        // Move focus to previous session
        if (currentIndex > 0) {
          const prevSession = sessions[currentIndex - 1]
          handleFocusSession?.(prevSession)

          // Use the pre-calculated flag for new sequences, or check isAddingToSelection for continuing sequences
          const shouldAdd = shouldAddToSelection || isAddingToSelection
          
          if (shouldAdd) {
            console.log('[shift+k] Adding to selection:', {
              anchor: selectionAnchor || focusedSession.id,
              target: prevSession.id,
            })
            // Continue adding to existing selections
            addRangeToSelection(selectionAnchor || focusedSession.id, prevSession.id)
          } else {
            console.log('[shift+k] Replacing selection:', {
              anchor: selectionAnchor || focusedSession.id,
              target: prevSession.id,
            })
            // Replace selections with new range
            selectRange(selectionAnchor || focusedSession.id, prevSession.id)
          }
        }
      }
    },
    {
      scopes: SessionTableHotkeysScope,
      enabled: !isSessionLauncherOpen,
      preventDefault: true,
    },
    [
      focusedSession,
      sessions,
      selectionAnchor,
      setSelectionAnchor,
      selectRange,
      addRangeToSelection,
      isAddingToSelection,
      handleFocusSession,
    ],
  )

  // Select all with meta+a (Cmd+A on Mac, Ctrl+A on Windows/Linux)
  useHotkeys(
    'meta+a',
    () => {
      // Toggle all sessions - if all are selected, deselect all; otherwise select all
      const allSelected = sessions.every(s => selectedSessions.has(s.id))

      sessions.forEach(session => {
        if (allSelected) {
          // Deselect all if all are selected
          if (selectedSessions.has(session.id)) {
            toggleSessionSelection(session.id)
          }
        } else {
          // Select all if not all are selected
          if (!selectedSessions.has(session.id)) {
            toggleSessionSelection(session.id)
          }
        }
      })
    },
    {
      scopes: SessionTableHotkeysScope,
      enabled: !isSessionLauncherOpen,
      preventDefault: true,
    },
    [sessions, selectedSessions, toggleSessionSelection],
  )

  useHotkeys(
    'enter',
    () => {
      if (focusedSession) {
        handleActivateSession?.(focusedSession)
      }
    },
    { scopes: SessionTableHotkeysScope, enabled: !isSessionLauncherOpen },
  )

  // Archive/unarchive hotkey
  useHotkeys(
    'e',
    async () => {
      if (focusedSession) {
        try {
          // Find the current session from the sessions array to get the latest archived status
          const currentSession = sessions.find(s => s.id === focusedSession.id)
          if (!currentSession) return

          console.log('Archive hotkey pressed:', {
            sessionId: currentSession.id,
            archived: currentSession.archived,
            willArchive: !currentSession.archived,
          })

          // If there are selected sessions, bulk archive them
          if (selectedSessions.size > 0) {
            const isArchiving = !currentSession.archived

            // Find next session to focus after bulk archive
            const nonSelectedSessions = sessions.filter(s => !selectedSessions.has(s.id))
            const nextFocusSession = nonSelectedSessions.length > 0 ? nonSelectedSessions[0] : null

            await bulkArchiveSessions(Array.from(selectedSessions), isArchiving)

            // Focus next available session
            if (nextFocusSession && handleFocusSession) {
              handleFocusSession(nextFocusSession)
            }

            toast.success(
              isArchiving
                ? `Archived ${selectedSessions.size} sessions`
                : `Unarchived ${selectedSessions.size} sessions`,
              {
                duration: 3000,
              },
            )
          } else {
            // Single session archive
            const isArchiving = !currentSession.archived

            // Find the index of current session and determine next focus
            const currentIndex = sessions.findIndex(s => s.id === currentSession.id)
            let nextFocusSession = null

            if (currentIndex > 0) {
              // Focus previous session if available
              nextFocusSession = sessions[currentIndex - 1]
            } else if (currentIndex < sessions.length - 1) {
              // Focus next session if no previous
              nextFocusSession = sessions[currentIndex + 1]
            }

            await archiveSession(currentSession.id, isArchiving)

            // Set focus to the determined session
            if (nextFocusSession && handleFocusSession) {
              handleFocusSession(nextFocusSession)
            }

            // Show success notification
            toast.success(isArchiving ? 'Session archived' : 'Session unarchived', {
              description: currentSession.summary || 'Untitled session',
              duration: 3000,
            })
          }
        } catch (error) {
          toast.error('Failed to archive session', {
            description: error instanceof Error ? error.message : 'Unknown error',
          })
        }
      }
    },
    {
      scopes: SessionTableHotkeysScope,
      enabled: !isSessionLauncherOpen && focusedSession !== null,
      preventDefault: true,
      enableOnFormTags: false,
    },
    [
      focusedSession,
      sessions,
      archiveSession,
      selectedSessions,
      bulkArchiveSessions,
      handleFocusSession,
    ],
  )

  // Toggle selection hotkey
  useHotkeys(
    'x',
    () => {
      if (focusedSession) {
        clearSelectionAnchor() // Clear anchor when toggling individual selections
        toggleSessionSelection(focusedSession.id)
      }
    },
    {
      scopes: SessionTableHotkeysScope,
      enabled: !isSessionLauncherOpen && focusedSession !== null,
      preventDefault: true,
      enableOnFormTags: false,
    },
    [focusedSession, toggleSessionSelection, clearSelectionAnchor],
  )

  return (
    <>
      {sessions.length > 0 ? (
        <>
          {/* TODO(2): Fix ref warning - Table component needs forwardRef */}
          <Table ref={tableRef}>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[40px]"></TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Working Directory</TableHead>
                <TableHead>Summary</TableHead>
                <TableHead>Model</TableHead>
                <TableHead>Started</TableHead>
                <TableHead>Last Activity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.map(session => (
                <TableRow
                  key={session.id}
                  data-session-id={session.id}
                  onMouseEnter={() => handleFocusSession?.(session)}
                  onMouseLeave={() => handleBlurSession?.()}
                  onClick={() => handleActivateSession?.(session)}
                  className={cn(
                    'cursor-pointer',
                    focusedSession?.id === session.id && '!bg-accent/20',
                    session.archived && 'opacity-60',
                  )}
                >
                  <TableCell
                    className="w-[40px]"
                    onClick={e => {
                      e.stopPropagation()
                      clearSelectionAnchor() // Clear anchor when clicking to toggle
                      toggleSessionSelection(session.id)
                    }}
                  >
                    <div className="flex items-center justify-center">
                      <div
                        className={cn(
                          'transition-all duration-200 ease-in-out',
                          focusedSession?.id === session.id || selectedSessions.size > 0
                            ? 'opacity-100 scale-100'
                            : 'opacity-0 scale-75',
                        )}
                      >
                        {selectedSessions.has(session.id) ? (
                          <CheckSquare className="w-4 h-4 text-primary" />
                        ) : (
                          <Square className="w-4 h-4 text-muted-foreground" />
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className={getStatusTextClass(session.status)}>{session.status}</TableCell>
                  <TableCell className="max-w-[200px]">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="block truncate cursor-help text-sm">
                          {truncatePath(session.working_dir)}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-[600px]">
                        <span className="font-mono text-sm">
                          {session.working_dir || 'No working directory'}
                        </span>
                      </TooltipContent>
                    </Tooltip>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span>{renderHighlightedText(session.summary, session.id)}</span>
                    </div>
                  </TableCell>
                  <TableCell>{session.model || <CircleOff className="w-4 h-4" />}</TableCell>
                  <TableCell>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-help">{formatTimestamp(session.start_time)}</span>
                      </TooltipTrigger>
                      <TooltipContent>{formatAbsoluteTimestamp(session.start_time)}</TooltipContent>
                    </Tooltip>
                  </TableCell>
                  <TableCell>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-help">{formatTimestamp(session.last_activity_at)}</span>
                      </TooltipTrigger>
                      <TooltipContent>
                        {formatAbsoluteTimestamp(session.last_activity_at)}
                      </TooltipContent>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      ) : emptyState ? (
        <EmptyState {...emptyState} />
      ) : (
        <div className="text-center py-8 text-muted-foreground">
          <p className="text-sm">No sessions found</p>
          {searchText && <p className="text-xs mt-1">Try adjusting your search filters</p>}
        </div>
      )}
    </>
  )
}
