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
import { useEffect } from 'react'
import { CircleOff } from 'lucide-react'
import { getStatusTextClass } from '@/utils/component-utils'
import { truncate, formatTimestamp, formatAbsoluteTimestamp } from '@/utils/formatting'

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
            <TableCell title={session.query}>{truncate(session.query, 50)}</TableCell>
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
