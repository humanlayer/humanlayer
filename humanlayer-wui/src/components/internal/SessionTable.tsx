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
import { useEffect, useState } from 'react'
import { CircleOff, ChevronDown, ChevronRight } from 'lucide-react'
import { getStatusTextClass } from '@/utils/component-utils'
import { truncate, formatTimestamp, formatAbsoluteTimestamp } from '@/utils/formatting'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible'

interface SessionTableProps {
  sessions: SessionInfo[]
  handleFocusSession?: (session: SessionInfo) => void
  handleBlurSession?: () => void
  handleFocusNextSession?: () => void
  handleFocusPreviousSession?: () => void
  handleActivateSession?: (session: SessionInfo) => void
  focusedSession: SessionInfo | null
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
}: SessionTableProps) {
  const { enableScope, disableScope } = useHotkeysContext()
  const [expandedQueryId, setExpandedQueryId] = useState<string | null>(null)

  useEffect(() => {
    enableScope(SessionTableHotkeysScope)
    return () => {
      disableScope(SessionTableHotkeysScope)
    }
  }, [])

  useHotkeys('j', () => handleFocusNextSession?.(), { scopes: SessionTableHotkeysScope })
  useHotkeys('k', () => handleFocusPreviousSession?.(), { scopes: SessionTableHotkeysScope })
  useHotkeys(
    'enter',
    () => {
      if (focusedSession) {
        handleActivateSession?.(focusedSession)
      }
    },
    { scopes: SessionTableHotkeysScope },
  )

  return (
    <Table>
      <TableCaption>A list of your recent sessions.</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Status</TableHead>
          <TableHead>Query</TableHead>
          <TableHead>Model</TableHead>
          <TableHead>Started</TableHead>
          <TableHead>Last Activity</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sessions.map(session => (
          <TableRow
            key={session.id}
            onMouseEnter={() => handleFocusSession?.(session)}
            onMouseLeave={() => handleBlurSession?.()}
            onClick={() => handleActivateSession?.(session)}
            className={`cursor-pointer ${focusedSession?.id === session.id ? '!bg-accent/20' : ''}`}
          >
            <TableCell className={getStatusTextClass(session.status)}>{session.status}</TableCell>
            <TableCell>
              {session.query.length > 50 ? (
                <Collapsible
                  open={expandedQueryId === session.id}
                  onOpenChange={open => setExpandedQueryId(open ? session.id : null)}
                >
                  <CollapsibleTrigger className="flex items-center gap-1 text-left">
                    <span>{truncate(session.query, 50)}</span>
                    {expandedQueryId === session.id ? (
                      <ChevronDown className="w-3 h-3 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="w-3 h-3 text-muted-foreground" />
                    )}
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="mt-1 text-sm text-foreground">{session.query}</div>
                  </CollapsibleContent>
                </Collapsible>
              ) : (
                <span>{session.query}</span>
              )}
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
  )
}
