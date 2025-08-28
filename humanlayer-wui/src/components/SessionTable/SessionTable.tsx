import React, { useEffect, useRef, useMemo } from 'react'
import { Session, SessionStatus } from '@/lib/daemon/types'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { useHotkeys, useHotkeysContext } from 'react-hotkeys-hook'
import { CircleOff, CheckSquare, Square, FileText, Pencil, ShieldOff } from 'lucide-react'
import { getStatusTextClass } from '@/utils/component-utils'
import { formatTimestamp, formatAbsoluteTimestamp } from '@/utils/formatting'
import { highlightMatches } from '@/lib/fuzzy-search'
import { useSessionLauncher } from '@/hooks/useSessionLauncher'
import { cn } from '@/lib/utils'
import { useStore } from '@/AppStore'
import { toast } from 'sonner'
import { EmptyState } from '../internal/EmptyState'
import type { LucideIcon } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { renderSessionStatus } from '@/utils/sessionStatus'
import { logger } from '@/lib/logging'
import { APIErrorBoundary } from '@/components/ui/APIErrorBoundary'
import { DataTransformErrorBoundary } from '@/components/ui/DataTransformErrorBoundary'
import { BaseErrorBoundary } from '@/components/ui/BaseErrorBoundary'

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

// Component to handle highlighted text rendering with data transform protection
interface HighlightedTextRendererProps {
  text: string
  sessionId: string
  searchText?: string
  matchedSessions?: Map<string, any>
}

const HighlightedTextRenderer = ({
  text,
  sessionId,
  searchText,
  matchedSessions,
}: HighlightedTextRendererProps) => {
  if (!searchText || !matchedSessions) return <>{text}</>

  const matchData = matchedSessions.get(sessionId)
  if (!matchData) return <>{text}</>

  // Find matches for the summary field
  const summaryMatch = matchData.matches?.find((m: any) => m.key === 'summary')
  if (!summaryMatch || !summaryMatch.indices) return <>{text}</>

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

// Component to handle session status rendering with data transform protection
interface SessionStatusRendererProps {
  session: Session
}

const SessionStatusRenderer = ({ session }: SessionStatusRendererProps) => {
  return (
    <DataTransformErrorBoundary
      dataContext="session status rendering"
      expectedDataType="SessionStatus"
      extractFailureInfo={error => ({
        operation: 'status display formatting',
        dataType: 'session status',
        rawData: { status: session.status, session },
        failureLocation: error.message.includes('renderSessionStatus')
          ? 'status renderer'
          : 'status calculation',
      })}
      fallbackData="Unknown"
      showErrorDetails={false}
      contextInfo={{ sessionId: session.id, status: session.status }}
    >
      <span className={getStatusTextClass(session.status)}>
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
      </span>
    </DataTransformErrorBoundary>
  )
}

// Component to handle session editing operations with API error protection
interface SessionEditHandlerProps {
  children: React.ReactNode
  sessionId: string
}

const SessionEditHandler = ({ children, sessionId }: SessionEditHandlerProps) => {
  return (
    <APIErrorBoundary
      operationContext={`editing session ${sessionId}`}
      autoReconnect={true}
      showNetworkDetails={false}
      contextInfo={{ sessionId, operation: 'session_edit' }}
      onRetry={async () => {
        // Retry logic handled by the store
        logger.log('Retrying session edit operation')
      }}
    >
      {children}
    </APIErrorBoundary>
  )
}

// Component to handle timestamp rendering with data transform protection
interface TimestampRendererProps {
  timestamp: string | Date
  sessionId: string
  label: string
}

const TimestampRenderer = React.memo(({ timestamp, sessionId, label }: TimestampRendererProps) => {
  // Stabilize timestamp to nearest minute to prevent constant re-renders
  const stableTimestamp = useMemo(() => {
    const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp
    if (!date || isNaN(date.getTime())) return timestamp
    
    // Round to nearest minute (60000ms = 1 minute)
    return new Date(Math.floor(date.getTime() / 60000) * 60000)
  }, [timestamp instanceof Date ? Math.floor(timestamp.getTime() / 60000) : timestamp])

  return (
    <DataTransformErrorBoundary
      dataContext={`${label} timestamp formatting`}
      expectedDataType="Date"
      extractFailureInfo={error => ({
        operation: 'timestamp formatting',
        dataType: 'timestamp',
        rawData: { timestamp, label },
        failureLocation: error.message.includes('Invalid Date') ? 'date parsing' : 'date formatting',
      })}
      fallbackData="Invalid Date"
      showErrorDetails={false}
      contextInfo={{ sessionId, label, timestamp }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-help">{formatTimestamp(stableTimestamp)}</span>
        </TooltipTrigger>
        <TooltipContent>{formatAbsoluteTimestamp(stableTimestamp)}</TooltipContent>
      </Tooltip>
    </DataTransformErrorBoundary>
  )
})

// Note: BulkOperationHandler removed - bulk operations are handled directly in the hotkey handlers with error boundaries

// Higher-order component to wrap navigation functions with error handling
const withNavigationErrorHandling = (navigationFn: () => void, operation: string) => {
  return () => {
    try {
      navigationFn()
    } catch (error) {
      logger.error(`Keyboard navigation error during ${operation}:`, error)
      toast.error(`Navigation error: ${operation}`, {
        description: error instanceof Error ? error.message : 'Unknown navigation error',
      })
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
    bulkSelect,
    // Session editing state and actions
    editingSessionId,
    editValue,
    startEdit,
    updateEditValue,
    saveEdit,
    cancelEdit,
  } = useStore()

  // Helper to start editing with the appropriate initial value
  const handleStartEdit = (sessionId: string, currentTitle: string, currentSummary: string) => {
    startEdit(sessionId, currentTitle || currentSummary || '')
  }

  // Helper to save edit with error handling
  const handleSaveEdit = async () => {
    try {
      await saveEdit()
    } catch (error) {
      toast.error('Failed to update session title', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  // Helper to render highlighted text with error boundary protection
  const renderHighlightedText = (text: string, sessionId: string) => {
    return (
      <DataTransformErrorBoundary
        dataContext="search highlighting"
        expectedDataType="HighlightedText"
        extractFailureInfo={error => ({
          operation: 'search highlight processing',
          dataType: 'search results',
          rawData: { text, sessionId, searchText, matchData: matchedSessions?.get(sessionId) },
          failureLocation: error.message.includes('indices') ? 'highlight indices' : 'text segments',
        })}
        fallbackData={text}
        showErrorDetails={false}
        contextInfo={{ sessionId, searchText }}
      >
        <HighlightedTextRenderer
          text={text}
          sessionId={sessionId}
          searchText={searchText}
          matchedSessions={matchedSessions}
        />
      </DataTransformErrorBoundary>
    )
  }

  const handleRowClick = (session: Session) => {
    if (selectedSessions.size > 0) {
      toggleSessionSelection(session.id)
      return null
    }
    handleActivateSession?.(session)
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
        focusedRow.scrollIntoView({ behavior: 'auto', block: 'nearest' })
      }
    }
  }, [focusedSession])

  useHotkeys(
    'j',
    withNavigationErrorHandling(() => {
      handleFocusNextSession?.()
    }, 'focus next session'),
    {
      scopes: SessionTableHotkeysScope,
      enabled: !isSessionLauncherOpen,
    },
    [handleFocusNextSession],
  )

  useHotkeys(
    'k',
    withNavigationErrorHandling(() => {
      handleFocusPreviousSession?.()
    }, 'focus previous session'),
    {
      scopes: SessionTableHotkeysScope,
      enabled: !isSessionLauncherOpen,
    },
    [handleFocusPreviousSession],
  )

  // Bulk selection with shift+j/k
  useHotkeys(
    'shift+j',
    withNavigationErrorHandling(() => {
      if (focusedSession && sessions.length > 0) {
        bulkSelect(focusedSession.id, 'desc')
      }
    }, 'bulk select down'),
    {
      scopes: SessionTableHotkeysScope,
      enabled: !isSessionLauncherOpen,
      preventDefault: true,
    },
    [focusedSession, sessions, bulkSelect],
  )

  useHotkeys(
    'shift+k',
    withNavigationErrorHandling(() => {
      if (focusedSession && sessions.length > 0) {
        bulkSelect(focusedSession.id, 'asc')
      }
    }, 'bulk select up'),
    {
      scopes: SessionTableHotkeysScope,
      enabled: !isSessionLauncherOpen,
      preventDefault: true,
    },
    [focusedSession, sessions, bulkSelect],
  )

  // Select all with meta+a (Cmd+A on Mac, Ctrl+A on Windows/Linux)
  useHotkeys(
    'meta+a',
    withNavigationErrorHandling(() => {
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
    }, 'select all sessions'),
    {
      scopes: SessionTableHotkeysScope,
      enabled: !isSessionLauncherOpen,
      preventDefault: true,
    },
    [sessions, selectedSessions, toggleSessionSelection],
  )

  useHotkeys(
    'enter',
    withNavigationErrorHandling(() => {
      if (focusedSession) {
        handleActivateSession?.(focusedSession)
      }
    }, 'activate session'),
    { scopes: SessionTableHotkeysScope, enabled: !isSessionLauncherOpen },
  )

  // Archive/unarchive hotkey - wrapped in error handling
  const handleArchiveOperation = async () => {
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
  }

  useHotkeys(
    'e',
    handleArchiveOperation,
    {
      scopes: SessionTableHotkeysScope,
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
    withNavigationErrorHandling(() => {
      if (focusedSession) {
        toggleSessionSelection(focusedSession.id)
      }
    }, 'toggle session selection'),
    {
      scopes: SessionTableHotkeysScope,
      enabled: !isSessionLauncherOpen && focusedSession !== null,
      preventDefault: true,
      enableOnFormTags: false,
    },
    [focusedSession, toggleSessionSelection],
  )

  // Rename session hotkey
  useHotkeys(
    'shift+r',
    withNavigationErrorHandling(() => {
      if (focusedSession) {
        handleStartEdit(focusedSession.id, focusedSession.title || '', focusedSession.summary || '')
      }
    }, 'start session rename'),
    {
      scopes: SessionTableHotkeysScope,
      enabled: !isSessionLauncherOpen && focusedSession !== null && editingSessionId === null,
      preventDefault: true,
      enableOnFormTags: false,
    },
    [focusedSession, handleStartEdit, editingSessionId],
  )

  return (
    <BaseErrorBoundary
      title="Session Table Error"
      description="An error occurred while rendering the session table. This may be due to corrupted session data or network issues."
      contextInfo={{
        sessionCount: sessions.length,
        focusedSessionId: focusedSession?.id,
        selectedSessionsCount: selectedSessions.size,
        searchText,
      }}
      showErrorDetails={true}
    >
      {sessions.length > 0 ? (
        <DataTransformErrorBoundary
          dataContext="session list rendering"
          expectedDataType="Session[]"
          extractFailureInfo={error => ({
            operation: 'table data processing',
            dataType: 'session data',
            rawData: { sessionCount: sessions.length, firstSession: sessions[0] },
            failureLocation: error.message.includes('map') ? 'session mapping' : 'table rendering',
          })}
          fallbackData={[]}
          showErrorDetails={false}
          contextInfo={{ sessionCount: sessions.length }}
        >
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
              {sessions.map(session => {
                // Stabilize session data to prevent timestamp-related re-renders
                const stableSession = useMemo(
                  () => ({
                    ...session,
                    // Round timestamps to nearest minute to prevent constant updates
                    createdAt: session.createdAt ? (
                      typeof session.createdAt === 'string' 
                        ? session.createdAt
                        : new Date(Math.floor(session.createdAt.getTime() / 60000) * 60000)
                    ) : session.createdAt,
                    lastActivityAt: session.lastActivityAt ? (
                      typeof session.lastActivityAt === 'string'
                        ? session.lastActivityAt
                        : new Date(Math.floor(session.lastActivityAt.getTime() / 60000) * 60000)
                    ) : session.lastActivityAt,
                  }),
                  [
                    session.id, 
                    session.status, 
                    session.title, 
                    session.summary, 
                    session.workingDir, 
                    session.model, 
                    session.archived,
                    session.dangerouslySkipPermissions,
                    session.autoAcceptEdits,
                    // Stabilize timestamp dependencies to nearest minute
                    session.createdAt instanceof Date 
                      ? Math.floor(session.createdAt.getTime() / 60000)
                      : session.createdAt,
                    session.lastActivityAt instanceof Date 
                      ? Math.floor(session.lastActivityAt.getTime() / 60000)
                      : session.lastActivityAt,
                  ]
                )
                
                return (
                <BaseErrorBoundary
                  key={session.id}
                  title={`Error rendering session ${session.id}`}
                  description="This session row failed to render, possibly due to corrupted session data."
                  contextInfo={{ sessionId: session.id, session }}
                  showErrorDetails={false}
                  showReloadButton={false}
                  fallback={({ retry }) => (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-4">
                        <div className="text-sm text-muted-foreground">
                          Failed to render session row
                        </div>
                        <Button onClick={retry} size="sm" variant="outline" className="mt-2">
                          Retry
                        </Button>
                      </TableCell>
                    </TableRow>
                  )}
                >
                  <TableRow
                    data-session-id={session.id}
                    onMouseEnter={() => {
                      handleFocusSession?.(session)
                    }}
                    onMouseLeave={() => {
                      handleBlurSession?.()
                    }}
                    onClick={() => handleRowClick(session)}
                    className={cn(
                      'cursor-pointer transition-shadow duration-200',
                      focusedSession?.id === session.id && [
                        'shadow-[inset_2px_0_0_0_var(--terminal-accent)]',
                        'bg-accent/10',
                      ],
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
                    <TableCell>
                      <SessionStatusRenderer session={stableSession} />
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
                              {stableSession.workingDir || '-'}
                            </bdo>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-[600px]">
                          <span className="font-mono text-sm">
                            {stableSession.workingDir || 'No working directory'}
                          </span>
                        </TooltipContent>
                      </Tooltip>
                    </TableCell>
                    <TableCell>
                      <SessionEditHandler sessionId={session.id}>
                        {editingSessionId === session.id ? (
                          <div className="flex items-center gap-2">
                            <Input
                              value={editValue}
                              onChange={e => updateEditValue(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') {
                                  e.preventDefault()
                                  handleSaveEdit()
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
                                handleSaveEdit()
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
                              {renderHighlightedText(
                                stableSession.title || stableSession.summary || '',
                                stableSession.id,
                              )}
                            </span>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={e => {
                                e.stopPropagation()
                                handleStartEdit(stableSession.id, stableSession.title || '', stableSession.summary || '')
                              }}
                              className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                          </div>
                        )}
                      </SessionEditHandler>
                    </TableCell>
                    <TableCell>{stableSession.model || <CircleOff className="w-4 h-4" />}</TableCell>
                    <TableCell>
                      <TimestampRenderer
                        timestamp={stableSession.createdAt}
                        sessionId={stableSession.id}
                        label="created"
                      />
                    </TableCell>
                    <TableCell>
                      <TimestampRenderer
                        timestamp={stableSession.lastActivityAt}
                        sessionId={stableSession.id}
                        label="last activity"
                      />
                    </TableCell>
                  </TableRow>
                </BaseErrorBoundary>
                )
              })}
            </TableBody>
          </Table>
        </DataTransformErrorBoundary>
      ) : emptyState ? (
        <EmptyState {...emptyState} />
      ) : (
        <EmptyState
          icon={FileText}
          title="No sessions found"
          message={searchText ? `No sessions matching "${searchText}"` : 'No sessions yet'}
        />
      )}
    </BaseErrorBoundary>
  )
}
