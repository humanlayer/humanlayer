import { useState, useEffect } from 'react'
import { daemonClient } from '@/lib/daemon'
import type { SessionInfo } from '@/lib/daemon/types'
import { create } from 'zustand'
import { Button } from '@/components/ui/button'
import './App.css'
import SessionTable from './components/internal/SessionTable'
import SessionDetail from './components/internal/SessionDetail'
import { ThemeProvider } from './components/providers/ThemeProvider'
import { ModeToggle } from './components/internal/ModeToggle'
import { SessionLauncher } from './components/SessionLauncher'
import { useSessionLauncher, useSessionLauncherHotkeys } from './hooks/useSessionLauncher'

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

  // Session launcher state
  const { isOpen, close } = useSessionLauncher()
  const { handleKeyDown } = useSessionLauncherHotkeys()

  // Connect to daemon on mount
  useEffect(() => {
    connectToDaemon()
  }, [])

  // Global hotkey handler
  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

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
      console.log('response.sessions', response.sessions)
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
    <ThemeProvider defaultTheme="light" storageKey="vite-ui-theme">
      <div className="fixed top-0 right-0 p-4">
        <ModeToggle />
      </div>

      <div className="min-h-screen flex flex-col">
        <main className="container max-w-[95%] mx-auto flex-1 flex flex-col justify-center p-8">
          {connected && (
            <>
              {activeSession ? (
                <SessionDetail session={activeSession} onClose={() => setActiveSession(null)} />
              ) : (
                <div style={{ marginBottom: '20px' }}>
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
                <div>
                  <h2>Pending Approvals ({approvals.length})</h2>
                  {approvals.map((approval, index) => (
                    <div
                      key={index}
                      style={{
                        marginBottom: '10px',
                        padding: '10px',
                        border: '1px solid #ff6600',
                      }}
                    >
                      <strong>Type:</strong> {approval.type}
                      <br />
                      {approval.function_call && (
                        <>
                          <strong>Function:</strong> {approval.function_call.spec.fn}
                          <br />
                          <strong>Args:</strong> {JSON.stringify(approval.function_call.spec.kwargs)}
                          <br />
                          <Button
                            onClick={() => handleApproval(approval, true)}
                            style={{ marginRight: '5px' }}
                          >
                            Approve
                          </Button>
                          <Button onClick={() => handleApproval(approval, false)}>Deny</Button>
                        </>
                      )}
                      {approval.human_contact && (
                        <>
                          <strong>Message:</strong> {approval.human_contact.spec.msg}
                          <br />
                          <Button onClick={() => handleApproval(approval, true)}>Respond</Button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </main>

        <div className="fixed bottom-0 left-0 right-0 bg-gray-900 dark:bg-gray-100 text-white dark:text-black p-2 flex justify-between items-center">
          <div className="flex-1">
            {!connected && (
              <Button
                onClick={connectToDaemon}
                variant="ghost"
                className="text-white hover:text-gray-300"
              >
                Retry Connection
              </Button>
            )}
          </div>

          <div className="flex items-center space-x-2">
            <span className="text-sm uppercase text-[0.8em]">{status}</span>
            <span
              className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-300' : 'bg-rose-400'}`}
            ></span>
          </div>
        </div>
      </div>

      {/* Session Launcher */}
      <SessionLauncher isOpen={isOpen} onClose={close} />
    </ThemeProvider>
  )
}

export default App
