import { Session, SessionStatus } from '@/lib/daemon/types'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { useHotkeys } from 'react-hotkeys-hook'
import { useEffect, useRef, useState } from 'react'
import { CircleOff, CheckSquare, Square, FileText, Pencil, ShieldOff } from 'lucide-react'
import { getStatusTextClass } from '@/utils/component-utils'
import { formatTimestamp, formatAbsoluteTimestamp } from '@/utils/formatting'
import { highlightMatches } from '@/lib/fuzzy-search'
import { useSessionLauncher } from '@/hooks/useSessionLauncher'
import { cn } from '@/lib/utils'
import { useStore } from '@/AppStore'
import { toast } from 'sonner'
import { EmptyState } from './EmptyState'
import type { LucideIcon } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { daemonClient } from '@/lib/daemon/client'
import { renderSessionStatus } from '@/utils/sessionStatus'
import { logger } from '@/lib/logging'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { HotkeyScopeBoundary } from '../HotkeyScopeBoundary'

interface SessionTableProps {
  sessions: Session[]
  handleFocusSession?: (session: Session) => void
  handleBlurSession?: () => void
  handleFocusNextSession?: () => void
  handleFocusPreviousSession?: () => void
  handleActivateSession?: (session: Session) => void
  focusedSession: Session | null
  searchText?: string
  matchedSessions?: Map<string, any>
  archived?: boolean // Add this to indicate if showing archived sessions
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
  archived = false,
  emptyState,
}: SessionTableProps) {
  const { isOpen: isSessionLauncherOpen } = useSessionLauncher()
  const tableRef = useRef<HTMLTableElement>(null)
  const { archiveSession, selectedSessions, toggleSessionSelection, bulkArchiveSessions, bulkSelect } =
    useStore()

  // Determine scope based on archived state
  const tableScope = archived ? HOTKEY_SCOPES.SESSIONS_ARCHIVED : HOTKEY_SCOPES.SESSIONS

  // State for inline editing
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')

  // Helper functions for inline editing
  const startEdit = (sessionId: string, currentTitle: string, currentSummary: string) => {
    setEditingSessionId(sessionId)
    setEditValue(currentTitle || currentSummary || '')
  }

  const saveEdit = async () => {
    if (!editingSessionId) return

    try {
      await daemonClient.updateSessionTitle(editingSessionId, editValue)

      // Update the session in the store
      useStore.getState().updateSession(editingSessionId, { title: editValue })

      setEditingSessionId(null)
      setEditValue('')
    } catch (error) {
      toast.error('Failed to update session title', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  const cancelEdit = () => {
    setEditingSessionId(null)
    setEditValue('')
  }

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

  const handleRowClick = (session: Session) => {
    if (selectedSessions.size > 0) {
      toggleSessionSelection(session.id)
      return null
    }
    handleActivateSession?.(session)
  }

  // Scope is now managed by parent component or initially active
  // No need for manual scope management here

  // Scroll focused session into view
  useEffect(() => {
    if (focusedSession && tableRef.current) {
      const focusedRow = tableRef.current.querySelector(`[data-session-id="${focusedSession.id}"]`)
      if (focusedRow) {
        focusedRow.scrollIntoView({ behavior: 'auto', block: 'nearest' })
      }
    }
  }, [focusedSession])

  useHotkeys(
    'j, ArrowDown',
    () => {
      handleFocusNextSession?.()
    },
    {
      scopes: [tableScope],
      enabled: !isSessionLauncherOpen,
    },
    [handleFocusNextSession],
  )

  useHotkeys(
    'k, ArrowUp',
    () => {
      handleFocusPreviousSession?.()
    },
    {
      scopes: [tableScope],
      enabled: !isSessionLauncherOpen,
    },
    [handleFocusPreviousSession],
  )

  // Bulk selection with shift+j/k and shift+arrow keys
  useHotkeys(
    'shift+j, shift+ArrowDown',
    () => {
      if (focusedSession && sessions.length > 0) {
        bulkSelect(focusedSession.id, 'desc')
      }
    },
    {
      scopes: [tableScope],
      enabled: !isSessionLauncherOpen,
      preventDefault: true,
    },
    [focusedSession, sessions, bulkSelect],
  )

  useHotkeys(
    'shift+k, shift+ArrowUp',
    () => {
      if (focusedSession && sessions.length > 0) {
        bulkSelect(focusedSession.id, 'asc')
      }
    },
    {
      scopes: [tableScope],
      enabled: !isSessionLauncherOpen,
      preventDefault: true,
    },
    [focusedSession, sessions, bulkSelect],
  )

  // Select all with meta+a (Cmd+A on Mac, Ctrl+A on Windows/Linux)
  useHotkeys(
    'meta+a, ctrl+a',
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
      scopes: [tableScope],
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
    { scopes: [tableScope], enabled: !isSessionLauncherOpen },
  )

  // Track if g>e was recently pressed to prevent 'e' from firing
  const gePressedRef = useRef<number | null>(null)

  // Handle g>e navigation (to prevent 'e' from archiving)
  useHotkeys(
    'g>e',
    () => {
      console.log('[SessionTable] g>e captured, blocking archive')
      gePressedRef.current = Date.now()
    },
    {
      preventDefault: true,
      scopes: [tableScope],
      enabled: !isSessionLauncherOpen,
    },
  )

  // Archive/unarchive hotkey
  useHotkeys(
    'e',
    async () => {
      console.log('[SessionTable] archive hotkey "e" fired')

      // Check if g>e was pressed recently (within 50ms)
      if (gePressedRef.current && Date.now() - gePressedRef.current < 50) {
        console.log('[SessionTable] Blocking archive due to recent g>e press')
        return
      }

      try {
        // Find the current session from the sessions array to get the latest archived status
        logger.log('Archive hotkey pressed:', {
          currentSession: sessions.find(s => s.id === focusedSession?.id),
          selectedSessions,
        })

        // If there are selected sessions, bulk archive them
        if (selectedSessions.size > 0) {
          logger.log('selectedSessions', selectedSessions)

          // Convert selectedSessions Set to array and get the sessions
          const selectedSessionObjects = Array.from(selectedSessions)
            .map(sessionId => sessions.find(s => s.id === sessionId))
            .filter(Boolean)

          // Check if all selected sessions have the same archived status
          const archivedStatuses = selectedSessionObjects.map(s => s?.archived)
          const allSameStatus = archivedStatuses.every(status => status === archivedStatuses[0])

          if (!allSameStatus) {
            toast.warning(
              'Cannot bulk change archived status for archived and unarchived sessions at the same time (deselect one or the other)',
            )
            return
          }

          const isArchiving = !archivedStatuses[0] // If all are unarchived, we're archiving

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
          const currentSession = sessions.find(s => s.id === focusedSession?.id)
          if (!currentSession) {
            logger.log('No current session found')
            return
          }
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
    },
    {
      scopes: [tableScope],
      enabled: !isSessionLauncherOpen && (focusedSession !== null || selectedSessions.size > 0),
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
        toggleSessionSelection(focusedSession.id)
      }
    },
    {
      scopes: [tableScope],
      enabled: !isSessionLauncherOpen && focusedSession !== null,
      preventDefault: true,
      enableOnFormTags: false,
    },
    [focusedSession, toggleSessionSelection],
  )

  // Rename session hotkey
  useHotkeys(
    'shift+r',
    () => {
      if (focusedSession) {
        startEdit(focusedSession.id, focusedSession.title || '', focusedSession.summary || '')
      }
    },
    {
      scopes: [tableScope],
      enabled: !isSessionLauncherOpen && focusedSession !== null && editingSessionId === null,
      preventDefault: true,
      enableOnFormTags: false,
    },
    [focusedSession, startEdit, editingSessionId],
  )

  return (
    <HotkeyScopeBoundary
      scope={tableScope}
      componentName={`SessionTable-${archived ? 'archived' : 'normal'}`}
    >
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
                  onMouseEnter={() => {
                    handleFocusSession?.(session)
                  }}
                  onMouseLeave={() => {
                    handleBlurSession?.()
                  }}
                  onClick={() => handleRowClick(session)}
                  className={cn(
                    'cursor-pointer transition-colors duration-200 border-l-2',
                    focusedSession?.id === session.id
                      ? ['border-l-[var(--terminal-accent)]', 'bg-accent/10']
                      : 'border-l-transparent',
                    session.archived && 'opacity-60',
                  )}
                >
                  <TableCell
                    className="w-[40px]"
                    onClick={e => {
                      e.stopPropagation()
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
                  <TableCell className={getStatusTextClass(session.status)}>
                    {session.status !== SessionStatus.Failed && (
                      <>
                        {session.dangerouslySkipPermissions ? (
                          <>
                            <ShieldOff
                              className="inline-block w-4 h-4 text-[var(--terminal-error)] animate-pulse-error align-text-bottom"
                              strokeWidth={3}
                            />{' '}
                          </>
                        ) : session.autoAcceptEdits ? (
                          <span className="align-text-top text-[var(--terminal-warning)] text-base leading-none animate-pulse-warning">
                            {'⏵⏵ '}
                          </span>
                        ) : null}
                      </>
                    )}
                    {renderSessionStatus(session)}
                  </TableCell>
                  <TableCell className="max-w-[200px]">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        {/* Sets direction RTL with ellipsis at the start, and uses an inner <bdo> LTR override to keep the entire path (slashes/tilde) in logical order*/}
                        <span
                          className="block truncate cursor-help text-sm"
                          style={{
                            direction: 'rtl',
                            textAlign: 'left',
                            overflow: 'hidden',
                            whiteSpace: 'nowrap',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          <bdo dir="ltr" style={{ unicodeBidi: 'bidi-override' }}>
                            {session.workingDir || '-'}
                          </bdo>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-[600px]">
                        <span className="font-mono text-sm">
                          {session.workingDir || 'No working directory'}
                        </span>
                      </TooltipContent>
                    </Tooltip>
                  </TableCell>
                  <TableCell>
                    {editingSessionId === session.id ? (
                      <div className="flex items-center gap-2">
                        <Input
                          value={editValue}
                          onChange={e => setEditValue(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              saveEdit()
                            } else if (e.key === 'Escape') {
                              e.preventDefault()
                              cancelEdit()
                            }
                          }}
                          onClick={e => e.stopPropagation()}
                          className="h-7 text-sm"
                          autoFocus
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={e => {
                            e.stopPropagation()
                            saveEdit()
                          }}
                          className="h-7 px-2"
                        >
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={e => {
                            e.stopPropagation()
                            cancelEdit()
                          }}
                          className="h-7 px-2"
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 group">
                        <span>
                          {renderHighlightedText(session.title || session.summary || '', session.id)}
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={e => {
                            e.stopPropagation()
                            startEdit(session.id, session.title || '', session.summary || '')
                          }}
                          className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                      </div>
                    )}
                  </TableCell>
                  <TableCell>{session.model || <CircleOff className="w-4 h-4" />}</TableCell>
                  <TableCell>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-help">{formatTimestamp(session.createdAt)}</span>
                      </TooltipTrigger>
                      <TooltipContent>{formatAbsoluteTimestamp(session.createdAt)}</TooltipContent>
                    </Tooltip>
                  </TableCell>
                  <TableCell>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-help">{formatTimestamp(session.lastActivityAt)}</span>
                      </TooltipTrigger>
                      <TooltipContent>{formatAbsoluteTimestamp(session.lastActivityAt)}</TooltipContent>
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
        <EmptyState
          icon={FileText}
          title="No sessions found"
          message={searchText ? `No sessions matching "${searchText}"` : 'No sessions yet'}
        />
      )}
    </HotkeyScopeBoundary>
  )
}
