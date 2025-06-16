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
import { useHotkeys } from 'react-hotkeys-hook'

interface SessionTableProps {
  sessions: SessionInfo[]
  handleFocusSession?: (session: SessionInfo) => void
  handleBlurSession?: () => void
  handleFocusNextSession?: () => void
  handleFocusPreviousSession?: () => void
  handleActivateSession?: (session: SessionInfo) => void
  focusedSession: SessionInfo | null
}

export default function SessionTable({
  sessions,
  handleFocusSession,
  handleBlurSession,
  handleFocusNextSession,
  handleFocusPreviousSession,
  handleActivateSession,
  focusedSession,
}: SessionTableProps) {
  useHotkeys('j', () => handleFocusNextSession?.())
  useHotkeys('k', () => handleFocusPreviousSession?.())
  useHotkeys('enter', () => {
    if (focusedSession) {
      handleActivateSession?.(focusedSession)
    }
  })

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
            <TableCell>{session.status}</TableCell>
            <TableCell>{session.query}</TableCell>
            <TableCell>{session.model}</TableCell>
            <TableCell>{session.start_time}</TableCell>
            <TableCell>{session.last_activity_at}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}