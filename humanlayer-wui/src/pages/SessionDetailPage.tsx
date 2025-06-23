import { useParams, useNavigate } from 'react-router-dom'
import SessionDetail from '@/components/internal/SessionDetail'
import { useSession } from '@/hooks'

export function SessionDetailPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()
  const { session } = useSession(sessionId)

  const handleClose = () => {
    navigate('/')
  }

  const handleRenameSession = (sessionId: string, newTitle: string) => {
    // TODO: This will be implemented when daemon API is ready
    console.log('Rename session:', sessionId, 'to:', newTitle)
    // For now, just log the rename attempt
    // When daemon agent completes, this will call the updateSession API
  }

  if (!session) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <h2 className="text-lg font-semibold mb-2">Session not found</h2>
          <p className="text-muted-foreground mb-4">
            The session you're looking for doesn't exist or hasn't loaded yet.
          </p>
          <button onClick={handleClose} className="text-primary hover:underline">
            ← Back to Sessions
          </button>
        </div>
      </div>
    )
  }

  return <SessionDetail session={session} onClose={handleClose} onRenameSession={handleRenameSession} />
}
