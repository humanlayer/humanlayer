import { useSearchParams, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useStore } from '@/AppStore'
import { Session } from '@/lib/daemon/types'
import { DraftSessionForm } from '@/components/internal/SessionDetail/components/DraftSessionForm'

export function DraftSessionPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const draftId = searchParams.get('id')

  const [draftSession, setDraftSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(!!draftId)

  const sessions = useStore(state => state.sessions)

  // Load existing draft if ID provided
  useEffect(() => {
    if (draftId) {
      const existingDraft = sessions.find(s => s.id === draftId)
      if (existingDraft) {
        setDraftSession(existingDraft)
        setLoading(false)
      } else {
        // Draft not found, navigate to new draft
        navigate('/sessions/draft', { replace: true })
        setLoading(false)
      }
    }
  }, [draftId, sessions, navigate])

  const handleClose = () => {
    navigate('/')
  }

  const handleLaunch = (sessionId: string) => {
    // After launching, navigate to the active session
    navigate(`/sessions/${sessionId}`)
  }

  if (loading) {
    return <div className="flex items-center justify-center h-full">Loading draft...</div>
  }

  return <DraftSessionForm existingDraft={draftSession} onClose={handleClose} onLaunch={handleLaunch} />
}
