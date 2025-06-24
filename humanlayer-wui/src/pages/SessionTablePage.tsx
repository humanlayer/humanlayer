import { useNavigate } from 'react-router-dom'
import { useStore } from '@/AppStore'
import SessionTable from '@/components/internal/SessionTable'

export function SessionTablePage() {
  const navigate = useNavigate()
  const sessions = useStore(state => state.sessions)
  const focusedSession = useStore(state => state.focusedSession)
  const setFocusedSession = useStore(state => state.setFocusedSession)
  const focusNextSession = useStore(state => state.focusNextSession)
  const focusPreviousSession = useStore(state => state.focusPreviousSession)

  const handleActivateSession = (session: any) => {
    navigate(`/sessions/${session.id}`)
  }

  return (
    <SessionTable
      sessions={sessions}
      handleFocusSession={session => setFocusedSession(session)}
      handleBlurSession={() => setFocusedSession(null)}
      handleActivateSession={handleActivateSession}
      focusedSession={focusedSession}
      handleFocusNextSession={focusNextSession}
      handleFocusPreviousSession={focusPreviousSession}
    />
  )
}
