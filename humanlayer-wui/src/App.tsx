import { useState, useEffect } from 'react'
import { daemonClient, SessionInfo } from './daemon-client'
import { create } from 'zustand'
import { Button } from '@/components/ui/button'
import './App.css'
import SessionTable from './components/internal/SessionTable'

interface StoreState {
  /* Sessions */
  sessions: SessionInfo[]
  selectedSessionId: string | null
  initSessions: (sessions: SessionInfo[]) => void
  setSelectedSessionId: (sessionId: string | null) => void
  selectNextSession: () => void
  selectPreviousSession: () => void
}

const useStore = create<StoreState>(set => ({
  sessions: [],
  selectedSessionId: null,
  initSessions: (sessions: SessionInfo[]) => set({ sessions }),
  setSelectedSessionId: (sessionId: string | null) => set({ selectedSessionId: sessionId }),
  selectNextSession: () =>
    set(state => {
      const { sessions, selectedSessionId } = state
      if (sessions.length === 0) return state

      const currentIndex = selectedSessionId ? sessions.findIndex(s => s.id === selectedSessionId) : -1

      // If no session is selected or we're at the last session, select the first session
      if (currentIndex === -1 || currentIndex === sessions.length - 1) {
        return { selectedSessionId: sessions[0].id }
      }

      // Select the next session
      return { selectedSessionId: sessions[currentIndex + 1].id }
    }),
  selectPreviousSession: () =>
    set(state => {
      const { sessions, selectedSessionId } = state
      if (sessions.length === 0) return state

      const currentIndex = selectedSessionId ? sessions.findIndex(s => s.id === selectedSessionId) : -1

      // If no session is selected or we're at the first session, select the last session
      if (currentIndex === -1 || currentIndex === 0) {
        return { selectedSessionId: sessions[sessions.length - 1].id }
      }

      // Select the previous session
      return { selectedSessionId: sessions[currentIndex - 1].id }
    }),
}))

function App() {
  const selectedSessionId = useStore(state => state.selectedSessionId)
  const [connected, setConnected] = useState(false)
  const [status, setStatus] = useState('')
  const [approvals, setApprovals] = useState<any[]>([])
  const [activeSessionId] = useState<string | null>(null)

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
      setConnected(true)
      setStatus('Connected!')

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
    <div className="min-h-screen flex flex-col">
      <main className="container max-w-[80%] mx-auto flex-1 flex flex-col justify-center p-8">
        {connected && (
          <>
            <div style={{ marginBottom: '20px' }}>
              <SessionTable
                sessions={useStore(state => state.sessions)}
                handleFocusSession={sessionId => useStore.getState().setSelectedSessionId(sessionId)}
                handleBlurSession={() => useStore.getState().setSelectedSessionId(null)}
                selectedSessionId={selectedSessionId}
                handleSelectNextSession={() => useStore.getState().selectNextSession()}
                handleSelectPreviousSession={() => useStore.getState().selectPreviousSession()}
              />
              {/*
              These will return, temporarily commenting out.
              <div style={{ marginBottom: '20px' }}>
                <h2>Launch New Session</h2>
                <input
                  type="text"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Enter your query..."
                  style={{ width: '300px', marginRight: '10px' }}
                />
                <Button onClick={launchSession}>Launch Session</Button>
              </div>

              <Button onClick={loadSessions} style={{ marginTop: '10px' }}>
                Refresh Sessions
              </Button> */}
            </div>

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

      <div className="fixed bottom-0 left-0 right-0 bg-gray-900 text-white p-2 flex justify-between items-center">
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
  )
}

export default App
