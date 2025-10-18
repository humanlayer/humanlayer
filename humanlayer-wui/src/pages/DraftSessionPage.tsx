import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useStore } from '@/AppStore'
import { DraftLauncherForm } from '@/components/internal/SessionDetail/components/DraftLauncherForm'
import { daemonClient } from '@/lib/daemon'
import { type Session, SessionStatus } from '@/lib/daemon/types'

export function DraftSessionPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const draftId = searchParams.get('id')

  const [draftSession, setDraftSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(!!draftId)

  const sessions = useStore(state => state.sessions)
  const refreshSessions = useStore(state => state.refreshSessions)
  const setActiveSessionDetail = useStore(state => state.setActiveSessionDetail)
  const clearActiveSessionDetail = useStore(state => state.clearActiveSessionDetail)

  // Load existing draft if ID provided
  useEffect(() => {
    const loadDraft = async () => {
      if (draftId) {
        setLoading(true)
        try {
          // Always fetch fresh from daemon to ensure we have latest data
          const allSessions = await daemonClient.listSessions()
          const existingDraft = allSessions.find(
            s => s.id === draftId && s.status === SessionStatus.Draft,
          )

          if (existingDraft) {
            console.log('[DraftSessionPage] Found existing draft:', existingDraft.id, existingDraft)
            setDraftSession(existingDraft)
            // Populate activeSessionDetail for draft session
            // Pass empty array for conversation since drafts don't have/need it
            console.log(
              '[DraftSessionPage] Calling setActiveSessionDetail with draft:',
              existingDraft.id,
            )
            setActiveSessionDetail(existingDraft.id, existingDraft, [])
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

    // Clear activeSessionDetail on unmount
    return () => {
      clearActiveSessionDetail()
    }
  }, [draftId, navigate, refreshSessions, setActiveSessionDetail, clearActiveSessionDetail]) // Include deps but loadDraft only runs when draftId changes

  const handleSessionUpdated = useCallback(async () => {
    // Refresh sessions to get the latest data
    await refreshSessions()

    // Check if a draft was just created by looking at the component's session prop
    // The child component creates the draft but parent doesn't know about it yet

    // If we have a draft session (either existing or newly created), populate activeSessionDetail
    if (draftSession?.id) {
      // Fetch fresh session data to ensure we have latest (including newly created drafts)
      const allSessions = await daemonClient.listSessions()
      const currentDraft = allSessions.find(
        s => s.id === draftSession.id && s.status === SessionStatus.Draft,
      )

      if (currentDraft) {
        setDraftSession(currentDraft)
        setActiveSessionDetail(currentDraft.id, currentDraft, [])
      }
    } else {
      // TODO: How do we know which draft was just created?
      // The child has the session ID but doesn't pass it to us
    }
  }, [draftSession?.id, refreshSessions, setActiveSessionDetail])

  // Handle case where draft is created without ID in URL (new draft)
  useEffect(() => {
    // If we have a draft session but no draftId in URL (new draft created),
    // populate activeSessionDetail
    if (draftSession && !draftId) {
      setActiveSessionDetail(draftSession.id, draftSession, [])
    }
  }, [draftSession, draftId, setActiveSessionDetail])

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
