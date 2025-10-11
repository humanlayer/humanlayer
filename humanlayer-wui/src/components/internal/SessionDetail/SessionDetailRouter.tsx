import { SessionStatus } from '@/lib/daemon/types'
import { Session } from '@/lib/daemon/types'
import { DraftLauncher } from './components/DraftLauncher'
import { ActiveSession } from './components/ActiveSession'
import { SentryErrorBoundary } from '@/components/ErrorBoundary'
import { useStore } from '@/AppStore'

interface SessionDetailProps {
  session: Session
  onClose: () => void
}

/**
 * SessionDetailRouter - Pure routing component that delegates to the appropriate session handler
 * This component contains no business logic, just a single routing decision.
 *
 * Architecture:
 * - Draft sessions → DraftLauncher
 * - Active/archived sessions → ActiveSession
 */
function SessionDetailRouter({ session, onClose }: SessionDetailProps) {
  const fetchActiveSessionDetail = useStore(state => state.fetchActiveSessionDetail)

  // Single routing decision - the ONLY isDraft check in the entire flow
  if (session.status === SessionStatus.Draft) {
    return (
      <DraftLauncher
        session={session}
        onSessionUpdated={() => fetchActiveSessionDetail(session.id)}
      />
    )
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