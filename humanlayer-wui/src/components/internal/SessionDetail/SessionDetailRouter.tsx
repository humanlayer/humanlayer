import { SessionStatus } from '@/lib/daemon/types'
import { Session } from '@/lib/daemon/types'
import { ActiveSession } from './components/ActiveSession'
import { SentryErrorBoundary } from '@/components/ErrorBoundary'
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

interface SessionDetailProps {
  session: Session
  onClose: () => void
}

/**
 * SessionDetailRouter - Pure routing component that delegates to the appropriate session handler
 * This component contains no business logic, just a single routing decision.
 *
 * Architecture:
 * - Draft sessions → Redirect to /sessions/draft route
 * - Active/archived sessions → ActiveSession
 */
function SessionDetailRouter({ session, onClose }: SessionDetailProps) {
  const navigate = useNavigate()

  // If a draft session somehow ends up here, redirect to the proper route
  useEffect(() => {
    if (session.status === SessionStatus.Draft) {
      // Draft sessions should use the dedicated /sessions/draft route
      navigate(`/sessions/draft?id=${session.id}`, { replace: true })
    }
  }, [session.status, session.id, navigate])

  // If it's a draft, show nothing while redirecting
  if (session.status === SessionStatus.Draft) {
    return null
  }

  // All non-draft sessions (active, archived, completed, failed, etc.) go to ActiveSession
  return <ActiveSession session={session} onClose={onClose} />
}

// Export with error boundary wrapper
const SessionDetailWithErrorBoundary = (props: SessionDetailProps) => {
  return (
    <SentryErrorBoundary
      variant="session-detail"
      componentName="SessionDetail"
      handleRefresh={() => {
        window.location.href = `/#/sessions/${props.session.id}`
      }}
      refreshButtonText="Reload Session"
    >
      <SessionDetailRouter {...props} />
    </SentryErrorBoundary>
  )
}

export default SessionDetailWithErrorBoundary
