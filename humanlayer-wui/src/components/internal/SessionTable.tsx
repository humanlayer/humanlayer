import { SessionInfo } from '@/daemon-client'
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
  handleFocusSession?: (sessionId: string) => void
  handleBlurSession?: () => void
  handleSelectNextSession?: () => void
  handleSelectPreviousSession?: () => void
  selectedSessionId: string | null
}

export default function SessionTable({
  sessions,
  handleFocusSession,
  handleBlurSession,
  handleSelectNextSession,
  handleSelectPreviousSession,
  selectedSessionId,
}: SessionTableProps) {

  useHotkeys('j', () => handleSelectNextSession?.())
  useHotkeys('k', () => handleSelectPreviousSession?.())

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
            onMouseEnter={() => handleFocusSession?.(session.id)} 
            onMouseLeave={() => handleBlurSession?.()}
            className={session.id === selectedSessionId ? "!bg-emerald-200" : ""}
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
