import { SessionInfo } from '@/lib/daemon/types'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { useHotkeys, useHotkeysContext } from 'react-hotkeys-hook'
import { useEffect, useRef } from 'react'
import { CircleOff, Archive, CheckSquare, Square } from 'lucide-react'
import { getStatusTextClass } from '@/utils/component-utils'
import { formatTimestamp, formatAbsoluteTimestamp, truncatePath } from '@/utils/formatting'
import { highlightMatches } from '@/lib/fuzzy-search'
import { useSessionLauncher } from '@/hooks/useSessionLauncher'
import { cn } from '@/lib/utils'
import { useStore } from '@/AppStore'
import { toast } from 'sonner'

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
}: SessionTableProps) {
  const { isOpen: isSessionLauncherOpen } = useSessionLauncher()
  const { enableScope, disableScope } = useHotkeysContext()
  const tableRef = useRef<HTMLTableElement>(null)
  const { archiveSession, selectedSessions, toggleSessionSelection, bulkArchiveSessions } = useStore()

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

  useHotkeys('j', () => handleFocusNextSession?.(), {
    scopes: SessionTableHotkeysScope,
    enabled: !isSessionLauncherOpen,
  })
  useHotkeys('k', () => handleFocusPreviousSession?.(), {
    scopes: SessionTableHotkeysScope,
    enabled: !isSessionLauncherOpen,
  })
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
          // If there are selected sessions, bulk archive them
          if (selectedSessions.size > 0) {
            const isArchiving = !focusedSession.archived
            await bulkArchiveSessions(Array.from(selectedSessions), isArchiving)

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
            const isArchiving = !focusedSession.archived
            await archiveSession(focusedSession.id, isArchiving)

            // Show success notification
            toast.success(isArchiving ? 'Session archived' : 'Session unarchived', {
              description: focusedSession.summary || 'Untitled session',
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
    [focusedSession, archiveSession, selectedSessions, bulkArchiveSessions],
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
      scopes: SessionTableHotkeysScope,
      enabled: !isSessionLauncherOpen && focusedSession !== null,
      preventDefault: true,
      enableOnFormTags: false,
    },
    [focusedSession, toggleSessionSelection],
  )

  return (
    <>
      {/* TODO(2): Fix ref warning - Table component needs forwardRef */}
      <Table ref={tableRef}>
        <TableCaption>A list of your recent sessions.</TableCaption>
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
                  toggleSessionSelection(session.id)
                }}
              >
                <div className="flex items-center justify-center">
                  {selectedSessions.has(session.id) ? (
                    <CheckSquare className="w-4 h-4 text-primary" />
                  ) : (
                    <Square className="w-4 h-4 text-muted-foreground" />
                  )}
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
                  {session.archived && <Archive className="w-4 h-4 text-muted-foreground" />}
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
                  <TooltipContent>{formatAbsoluteTimestamp(session.last_activity_at)}</TooltipContent>
                </Tooltip>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {sessions.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">
          <p className="text-sm">No sessions found</p>
          {searchText && <p className="text-xs mt-1">Try adjusting your search filters</p>}
        </div>
      )}
    </>
  )
}
