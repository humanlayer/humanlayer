import { useState, useEffect } from 'react'
import { daemonClient } from '@/lib/daemon'
import type { SessionInfo } from '@/lib/daemon/types'
import { create } from 'zustand'
import { Button } from '@/components/ui/button'
import { ThemeSelector } from '@/components/ThemeSelector'
import './App.css'
import SessionTable from './components/internal/SessionTable'
import SessionDetail from './components/internal/SessionDetail'

interface StoreState {
  /* Sessions */
  sessions: SessionInfo[]
  focusedSession: SessionInfo | null
  activeSession: SessionInfo | null
  initSessions: (sessions: SessionInfo[]) => void
  setFocusedSession: (session: SessionInfo | null) => void
  setActiveSession: (session: SessionInfo | null) => void
  focusNextSession: () => void
  focusPreviousSession: () => void
}

const useStore = create<StoreState>(set => ({
  sessions: [],
  focusedSession: null,
  activeSession: null,
  initSessions: (sessions: SessionInfo[]) => set({ sessions }),
  setFocusedSession: (session: SessionInfo | null) => set({ focusedSession: session }),
  setActiveSession: (session: SessionInfo | null) => set({ activeSession: session }),
  focusNextSession: () =>
    set(state => {
      const { sessions, focusedSession } = state
      if (sessions.length === 0) return state

      const currentIndex = focusedSession ? sessions.findIndex(s => s.id === focusedSession.id) : -1

      // If no session is focused or we're at the last session, focus the first session
      if (currentIndex === -1 || currentIndex === sessions.length - 1) {
        return { focusedSession: sessions[0] }
      }

      // Focus the next session
      return { focusedSession: sessions[currentIndex + 1] }
    }),
  focusPreviousSession: () =>
    set(state => {
      const { sessions, focusedSession } = state
      if (sessions.length === 0) return state

      const currentIndex = focusedSession ? sessions.findIndex(s => s.id === focusedSession.id) : -1

      // If no session is focused or we're at the first session, focus the last session
      if (currentIndex === -1 || currentIndex === 0) {
        return { focusedSession: sessions[sessions.length - 1] }
      }

      // Focus the previous session
      return { focusedSession: sessions[currentIndex - 1] }
    }),
}))

function App() {
  const focusedSession = useStore(state => state.focusedSession)
  const activeSession = useStore(state => state.activeSession)
  const sessions = useStore(state => state.sessions)
  const setFocusedSession = useStore(state => state.setFocusedSession)
  const setActiveSession = useStore(state => state.setActiveSession)
  const focusNextSession = useStore(state => state.focusNextSession)
  const focusPreviousSession = useStore(state => state.focusPreviousSession)
  const [status, setStatus] = useState('')
  const [approvals, setApprovals] = useState<any[]>([])
  const [activeSessionId] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)

  // Connect to daemon on mount
  useEffect(() => {
    connectToDaemon()
  }, [])

  // Cleanup subscription when component unmounts or session changes
  useEffect(() => {
    let unsubscribe: (() => void) | null = null

    if (activeSessionId) {
      // Subscribe to events for the active session
      daemonClient
        .subscribeToEvents({
          session_id: activeSessionId,
        })
        .then((unsub: () => void) => {
          unsubscribe = unsub
        })
        .catch((error: Error) => {
          console.error('Failed to subscribe to events:', error)
        })
    }

    return () => {
      if (unsubscribe) {
        unsubscribe()
      }
    }
  }, [activeSessionId])

  const connectToDaemon = async () => {
    try {
      setStatus('Connecting to daemon...')
      await daemonClient.connect()
      setStatus('Connected!')
      setConnected(true)

      // Check health
      const health = await daemonClient.health()
      setStatus(`Connected! Daemon @ ${health.version}`)

      // Load sessions
      await loadSessions()
    } catch (error) {
      setStatus(`Failed to connect: ${error}`)
      setConnected(false)
    }
  }

  const loadSessions = async () => {
    try {
      const response = await daemonClient.listSessions()
      useStore.getState().initSessions(response.sessions)
    } catch (error) {
      console.error('Failed to load sessions:', error)
    }
  }

  const handleApproval = async (approval: any, approved: boolean) => {
    try {
      if (approval.type === 'function_call' && approval.function_call) {
        if (approved) {
          await daemonClient.approveFunctionCall(approval.function_call.call_id, 'Approved via UI')
        } else {
          await daemonClient.denyFunctionCall(approval.function_call.call_id, 'Denied via UI')
        }
      } else if (approval.type === 'human_contact' && approval.human_contact) {
        const response = prompt('Enter your response:')
        if (response) {
          await daemonClient.respondToHumanContact(approval.human_contact.call_id, response)
        }
      }

      // Refresh approvals
      if (activeSessionId) {
        const response = await daemonClient.fetchApprovals(activeSessionId)
        setApprovals(response.approvals)
      }
    } catch (error) {
      alert(`Failed to handle approval: ${error}`)
    }
  }

  return (
    <div className="h-screen flex flex-col bg-background text-foreground">
      {/* Header */}
      <div className="border-b border-border"></div>

      {/* Main content */}
      <main className="flex-1 flex flex-col p-4 overflow-hidden">
        {connected && (
          <>
            {activeSession ? (
              <SessionDetail session={activeSession} onClose={() => setActiveSession(null)} />
            ) : (
              <div className="flex-1 overflow-hidden">
                <SessionTable
                  sessions={sessions}
                  handleFocusSession={session => setFocusedSession(session)}
                  handleBlurSession={() => setFocusedSession(null)}
                  handleActivateSession={session => setActiveSession(session)}
                  focusedSession={focusedSession}
                  handleFocusNextSession={focusNextSession}
                  handleFocusPreviousSession={focusPreviousSession}
                />
              </div>
            )}

            {approvals.length > 0 && (
              <div className="mt-4 border-t border-border pt-4">
                <h2 className="font-mono uppercase tracking-wider text-accent mb-4">
                  Pending Approvals ({approvals.length})
                </h2>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {approvals.map((approval, index) => (
                    <div
                      key={index}
                      className="p-4 border border-border bg-secondary/20 font-mono text-sm"
                    >
                      <div className="mb-2">
                        <span className="text-accent">Type:</span> {approval.type}
                      </div>
                      {approval.function_call && (
                        <>
                          <div className="mb-2">
                            <span className="text-accent">Function:</span>{' '}
                            {approval.function_call.spec.fn}
                          </div>
                          <div className="mb-3">
                            <span className="text-accent">Args:</span>{' '}
                            {JSON.stringify(approval.function_call.spec.kwargs)}
                          </div>
                          <div className="flex gap-2">
                            <Button onClick={() => handleApproval(approval, true)} size="sm">
                              Approve
                            </Button>
                            <Button
                              onClick={() => handleApproval(approval, false)}
                              variant="destructive"
                              size="sm"
                            >
                              Deny
                            </Button>
                          </div>
                        </>
                      )}
                      {approval.human_contact && (
                        <>
                          <div className="mb-3">
                            <span className="text-accent">Message:</span>{' '}
                            {approval.human_contact.spec.msg}
                          </div>
                          <Button onClick={() => handleApproval(approval, true)} size="sm">
                            Respond
                          </Button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {/* Status bar */}
      <div className="flex justify-between items-center px-3 py-1.5 border-t border-border bg-secondary/30">
        <div className="flex items-center gap-4">
          <div className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
            humanlayer
          </div>
          {!connected && (
            <Button onClick={connectToDaemon} variant="ghost" size="sm">
              Retry Connection
            </Button>
          )}
        </div>
        <div className="flex items-center gap-3">
          <ThemeSelector />
          <div className="flex items-center gap-2 font-mono text-xs">
            <span className="uppercase tracking-wider">{status}</span>
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                connected ? 'bg-[--terminal-success]' : 'bg-[--terminal-error]'
              }`}
            ></span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default App
