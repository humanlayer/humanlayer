import { useStore } from '@/AppStore'
import { DraftLauncherForm } from '@/components/internal/SessionDetail/components/DraftLauncherForm'
import { daemonClient } from '@/lib/daemon'
import { type Session, SessionStatus } from '@/lib/daemon/types'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

export function DraftSessionPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const draftId = searchParams.get('id')

  const [draftSession, setDraftSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(!!draftId)

  const sessions = useStore(state => state.sessions)
  const refreshSessions = useStore(state => state.refreshSessions)
  const fetchActiveSessionDetail = useStore(state => state.fetchActiveSessionDetail)

  // Load existing draft if ID provided
  useEffect(() => {
    const loadDraft = async () => {
      if (draftId) {
        setLoading(true)
        try {
          // Always fetch fresh from daemon to ensure we have latest data
          const allSessions = await daemonClient.listSessions()
          console.log(
            'editorState allSessions',
            allSessions.filter(s => s.status === SessionStatus.Draft),
          )
          const existingDraft = allSessions.find(
            s => s.id === draftId && s.status === SessionStatus.Draft,
          )

          console.log(
            `proxy info`,
            existingDraft?.model,
            existingDraft?.modelId,
            existingDraft?.proxyBaseUrl,
            existingDraft?.proxyModelOverride,
            existingDraft?.proxyEnabled,
          )

          if (existingDraft) {
            setDraftSession(existingDraft)
            // Refresh local store to ensure consistency
            await refreshSessions()
          } else {
            // Draft not found, navigate to new draft
            console.error('Draft not found with ID:', draftId)
            navigate('/sessions/draft', { replace: true })
          }
        } catch (error) {
          console.error('Failed to load draft:', error)
          navigate('/sessions/draft', { replace: true })
        } finally {
          setLoading(false)
        }
      } else {
        // No draft ID provided, we'll create one lazily when user starts typing
        setLoading(false)
      }
    }

    loadDraft()
  }, [draftId, navigate, refreshSessions]) // Include deps but loadDraft only runs when draftId changes

  const handleSessionUpdated = useCallback(() => {
    // Refresh the session detail if it was updated
    if (draftSession?.id) {
      fetchActiveSessionDetail(draftSession.id)
    }
  }, [draftSession?.id, fetchActiveSessionDetail])

  // Monitor session status changes (when draft is launched)
  useEffect(() => {
    if (draftSession?.id) {
      const currentSession = sessions.find(s => s.id === draftSession.id)
      if (currentSession && currentSession.status !== SessionStatus.Draft) {
        // Session has been launched, navigate to the active session view
        navigate(`/sessions/${draftSession.id}`)
      }
    }
  }, [sessions, draftSession?.id, navigate])

  if (loading) {
    return <div className="flex items-center justify-center h-full">Loading draft...</div>
  }

  return (
    <DraftLauncherForm
      session={draftSession}
      key={draftSession?.id} // this avoids us needing a useEffect when the session changes
      onSessionUpdated={handleSessionUpdated}
    />
  )
}
