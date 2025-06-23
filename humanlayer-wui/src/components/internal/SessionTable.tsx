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
import { useHotkeys, useHotkeysContext } from 'react-hotkeys-hook'
import React, { useEffect, useState } from 'react'
import { CircleOff } from 'lucide-react'
import { getStatusTextClass } from '@/utils/component-utils'
import { truncate } from '@/utils/formatting'
import { Input } from '../ui/input'

interface SessionTableProps {
  sessions: SessionInfo[]
  handleFocusSession?: (session: SessionInfo) => void
  handleBlurSession?: () => void
  handleFocusNextSession?: () => void
  handleFocusPreviousSession?: () => void
  handleActivateSession?: (session: SessionInfo) => void
  focusedSession: SessionInfo | null
  handleRenameSession?: (sessionId: string, newTitle: string) => void
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
  handleRenameSession,
}: SessionTableProps) {
  const { enableScope, disableScope } = useHotkeysContext()
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')

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
  useHotkeys(
    'n',
    () => {
      if (focusedSession && !editingSessionId) {
        setEditingSessionId(focusedSession.id)
        setEditingTitle(focusedSession.query)
      }
    },
    { scopes: SessionTableHotkeysScope },
  )

  const handleSaveRename = (sessionId: string) => {
    if (editingTitle.trim() && handleRenameSession) {
      handleRenameSession(sessionId, editingTitle.trim())
    }
    setEditingSessionId(null)
    setEditingTitle('')
  }

  const handleCancelRename = () => {
    setEditingSessionId(null)
    setEditingTitle('')
  }

  const handleKeyDown = (e: React.KeyboardEvent, sessionId: string) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSaveRename(sessionId)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      handleCancelRename()
    }
  }

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
            <TableCell title={session.query}>
              {editingSessionId === session.id ? (
                <Input
                  value={editingTitle}
                  onChange={e => setEditingTitle(e.target.value)}
                  onKeyDown={e => handleKeyDown(e, session.id)}
                  onBlur={() => handleSaveRename(session.id)}
                  autoFocus
                  className="w-full"
                  onClick={e => e.stopPropagation()}
                />
              ) : (
                <span>{truncate(session.query, 50)}</span>
              )}
            </TableCell>
            <TableCell>{session.model || <CircleOff className="w-4 h-4" />}</TableCell>
            <TableCell>{session.start_time}</TableCell>
            <TableCell>{session.last_activity_at}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
