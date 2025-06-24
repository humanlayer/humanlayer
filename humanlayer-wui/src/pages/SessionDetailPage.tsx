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

  return <SessionDetail session={session} onClose={handleClose} />
}
