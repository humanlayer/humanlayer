import { useEffect, useState, createContext, useContext } from 'react'
import { create, StoreApi, useStore } from 'zustand'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import SessionTable from '@/components/internal/SessionTable'
import { SessionTableSearch } from '@/components/SessionTableSearch'
import { useSessionFilter } from '@/hooks/useSessionFilter'
import { SessionInfo, SessionStatus } from '@/lib/daemon/types'
import { ThemeSelector } from '@/components/ThemeSelector'

// Mock session data for demo
const mockSessions: SessionInfo[] = [
  {
    id: 'session-1',
    run_id: 'run-1',
    claude_session_id: 'claude-1',
    status: SessionStatus.Running,
    start_time: '2024-01-15T10:00:00Z',
    last_activity_at: '2024-01-15T10:15:00Z',
    query: 'Help me debug this React component',
    summary: 'Debugging React component rendering issues',
    model: 'claude-3-5-sonnet-20241022',
    working_dir: '/home/user/projects/react-app',
  },
  {
    id: 'session-2',
    run_id: 'run-2',
    claude_session_id: 'claude-2',
    status: SessionStatus.WaitingInput,
    start_time: '2024-01-15T09:30:00Z',
    last_activity_at: '2024-01-15T10:20:00Z',
    query: 'Create a new API endpoint',
    summary: 'Building REST API endpoint for user management',
    model: 'claude-3-5-sonnet-20241022',
    working_dir: '/home/user/projects/api-server',
  },
  {
    id: 'session-3',
    run_id: 'run-3',
    claude_session_id: 'claude-3',
    status: SessionStatus.Completed,
    start_time: '2024-01-15T08:00:00Z',
    end_time: '2024-01-15T09:15:00Z',
    last_activity_at: '2024-01-15T09:15:00Z',
    query: 'Write unit tests for the authentication module',
    summary: 'Unit tests for authentication and authorization',
    model: 'claude-3-5-sonnet-20241022',
    working_dir: '/home/user/projects/auth-service',
  },
  {
    id: 'session-4',
    run_id: 'run-4',
    claude_session_id: 'claude-4',
    status: SessionStatus.Failed,
    start_time: '2024-01-15T07:00:00Z',
    end_time: '2024-01-15T07:30:00Z',
    last_activity_at: '2024-01-15T07:30:00Z',
    error: 'Connection timeout',
    query: 'Deploy application to production',
    summary: 'Production deployment with CI/CD pipeline',
    model: 'claude-3-5-sonnet-20241022',
    working_dir: '/home/user/projects/deployment',
  },
  {
    id: 'session-5',
    run_id: 'run-5',
    claude_session_id: 'claude-5',
    status: SessionStatus.Starting,
    start_time: '2024-01-15T10:25:00Z',
    last_activity_at: '2024-01-15T10:25:00Z',
    query: 'Optimize database queries',
    summary: 'Performance optimization for database operations',
    model: 'claude-3-5-sonnet-20241022',
    working_dir: '/home/user/projects/database-app',
  },
]

// Store interface for managing sessions
interface SessionStore {
  sessions: SessionInfo[]
  focusedSession: SessionInfo | null
  setFocusedSession: (session: SessionInfo | null) => void
  setSessions: (sessions: SessionInfo[]) => void
  addSession: (session: SessionInfo) => void
  updateSession: (id: string, updates: Partial<SessionInfo>) => void
}

// Animation step for demo sequences
interface AnimationStep {
  state: Partial<SessionStore>
  delay: number
}

// Store factory that creates a session store
function createSessionStore(isDemo: boolean = false): StoreApi<SessionStore> {
  return create<SessionStore>((set, get) => ({
    sessions: [],
    focusedSession: null,
    setFocusedSession: (session: SessionInfo | null) => {
      if (!isDemo) {
        set({ focusedSession: session })
      }
    },
    setSessions: (sessions: SessionInfo[]) => {
      if (!isDemo) {
        set({ sessions })
      }
    },
    addSession: (session: SessionInfo) => {
      if (!isDemo) {
        set(state => ({ sessions: [...state.sessions, session] }))
      }
    },
    updateSession: (id: string, updates: Partial<SessionInfo>) => {
      if (!isDemo) {
        set(state => ({
          sessions: state.sessions.map(session =>
            session.id === id ? { ...session, ...updates } : session
          ),
        }))
      }
    },
  }))
}

// Demo animator for session sequences
class SessionDemoAnimator {
  private store: StoreApi<SessionStore>
  private sequence: AnimationStep[]
  private currentIndex: number = 0
  private timeoutId: NodeJS.Timeout | null = null
  private isRunning: boolean = false
  private unsubscribe: (() => void) | null = null

  constructor(store: StoreApi<SessionStore>, sequence: AnimationStep[]) {
    this.store = store
    this.sequence = sequence

    this.unsubscribe = store.subscribe(
      state => state.sessions.length,
      count => {
        console.log('[Session Demo Store] Sessions updated, count:', count)
      },
    )
  }

  start() {
    this.isRunning = true
    this.currentIndex = 0
    this.playNext()
  }

  stop() {
    this.isRunning = false
    if (this.timeoutId) {
      clearTimeout(this.timeoutId)
      this.timeoutId = null
    }
    if (this.unsubscribe) {
      this.unsubscribe()
      this.unsubscribe = null
    }
  }

  private playNext() {
    if (!this.isRunning || this.currentIndex >= this.sequence.length) {
      if (this.isRunning) {
        this.currentIndex = 0
        this.playNext()
      }
      return
    }

    const step = this.sequence[this.currentIndex]

    this.timeoutId = setTimeout(() => {
      this.store.setState(step.state as SessionStore)
      this.currentIndex++
      this.playNext()
    }, step.delay)
  }
}

// Context for session store
const SessionStoreContext = createContext<StoreApi<SessionStore> | null>(null)

// Hook to use the session store
function useSessionStore<T>(selector: (state: SessionStore) => T): T {
  const store = useContext(SessionStoreContext)
  if (!store) throw new Error('useSessionStore must be used within a SessionStoreProvider')
  return useStore(store, selector)
}


// Provider for demo store with animation sequence
interface DemoSessionStoreProviderProps {
  children: React.ReactNode
  sequence: AnimationStep[]
}

function DemoSessionStoreProvider({ children, sequence }: DemoSessionStoreProviderProps) {
  const [demoStore] = useState(() => createSessionStore(true))
  const [animator] = useState(() => new SessionDemoAnimator(demoStore, sequence))

  useEffect(() => {
    animator.start()

    return () => {
      animator.stop()
      demoStore.setState({ sessions: [], focusedSession: null })
    }
  }, [animator, demoStore])

  return <SessionStoreContext.Provider value={demoStore}>{children}</SessionStoreContext.Provider>
}

// Session table component wrapper
function SessionTableWrapper() {
  const [searchQuery, setSearchQuery] = useState('')
  const sessions = useSessionStore(state => state.sessions)
  const focusedSession = useSessionStore(state => state.focusedSession)
  const setFocusedSession = useSessionStore(state => state.setFocusedSession)

  const { filteredSessions, statusFilter, searchText, matchedSessions } = useSessionFilter({
    sessions,
    query: searchQuery,
    searchFields: ['summary'],
  })

  const handleActivateSession = (session: SessionInfo) => {
    console.log('Activating session:', session.id)
    // In demo mode, this would navigate to session detail
  }

  const focusNextSession = () => {
    if (filteredSessions.length === 0) return
    
    const currentIndex = focusedSession
      ? filteredSessions.findIndex(s => s.id === focusedSession.id)
      : -1

    if (currentIndex === -1 || currentIndex === filteredSessions.length - 1) {
      setFocusedSession(filteredSessions[0])
    } else {
      setFocusedSession(filteredSessions[currentIndex + 1])
    }
  }

  const focusPreviousSession = () => {
    if (filteredSessions.length === 0) return
    
    const currentIndex = focusedSession
      ? filteredSessions.findIndex(s => s.id === focusedSession.id)
      : -1

    if (currentIndex === -1 || currentIndex === 0) {
      setFocusedSession(filteredSessions[filteredSessions.length - 1])
    } else {
      setFocusedSession(filteredSessions[currentIndex - 1])
    }
  }

  return (
    <div className="space-y-4">
      <SessionTableSearch
        value={searchQuery}
        onChange={setSearchQuery}
        statusFilter={statusFilter}
        placeholder="Search sessions or filter by status:..."
      />
      
      <div className="max-h-96 overflow-y-auto">
        <SessionTable
          sessions={filteredSessions}
          handleFocusSession={setFocusedSession}
          handleBlurSession={() => setFocusedSession(null)}
          handleActivateSession={handleActivateSession}
          focusedSession={focusedSession}
          handleFocusNextSession={focusNextSession}
          handleFocusPreviousSession={focusPreviousSession}
          searchText={searchText}
          matchedSessions={matchedSessions}
        />
      </div>
    </div>
  )
}

// Labeled wrapper for demo vs real
function LabeledSessionTable({ label, variant }: { label: string; variant: 'default' | 'secondary' }) {
  return (
    <div className="space-y-2">
      <Badge variant={variant} className="text-sm">
        {label}
      </Badge>
      <Card className="w-full">
        <CardContent className="p-4">
          <SessionTableWrapper />
        </CardContent>
      </Card>
    </div>
  )
}

// Demo sequences
const basicSessionSequence: AnimationStep[] = [
  { state: { sessions: mockSessions.slice(0, 1) }, delay: 1000 },
  { state: { sessions: mockSessions.slice(0, 2) }, delay: 2000 },
  { state: { sessions: mockSessions.slice(0, 3) }, delay: 1500 },
  { state: { sessions: mockSessions.slice(0, 4) }, delay: 2000 },
  { state: { sessions: mockSessions }, delay: 1000 },
  { state: { sessions: [] }, delay: 3000 },
]

const statusChangeSequence: AnimationStep[] = [
  { state: { sessions: mockSessions }, delay: 1000 },
  { 
    state: { 
      sessions: mockSessions.map(s => 
        s.id === 'session-1' ? { ...s, status: SessionStatus.WaitingInput } : s
      ) 
    }, 
    delay: 2000 
  },
  { 
    state: { 
      sessions: mockSessions.map(s => 
        s.id === 'session-1' ? { ...s, status: SessionStatus.Completed } : s
      ) 
    }, 
    delay: 2000 
  },
  { 
    state: { 
      sessions: mockSessions.map(s => 
        s.id === 'session-2' ? { ...s, status: SessionStatus.Running } : s
      ) 
    }, 
    delay: 1500 
  },
  { state: { sessions: mockSessions }, delay: 3000 },
]

// Main demo page
export default function WuiDemo() {
  const [sequenceType, setSequenceType] = useState<'basic' | 'status'>('basic')
  const sequence = sequenceType === 'basic' ? basicSessionSequence : statusChangeSequence

  return (
    <div className="container mx-auto p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold">WUI Session Table Demo</h1>
          <p className="text-muted-foreground">
            Session table component connected to demo store for synthetic product shots
          </p>
        </div>

        <div className="flex justify-center items-center gap-4">
          <Button
            onClick={() => setSequenceType('basic')}
            variant={sequenceType === 'basic' ? 'default' : 'outline'}
            size="sm"
          >
            Basic Sequence
          </Button>
          <Button
            onClick={() => setSequenceType('status')}
            variant={sequenceType === 'status' ? 'default' : 'outline'}
            size="sm"
          >
            Status Changes
          </Button>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Theme:</span>
            <ThemeSelector />
          </div>
        </div>

        <div className="flex justify-center">
          <div className="w-full max-w-4xl">
            <DemoSessionStoreProvider sequence={sequence} key={sequenceType}>
              <LabeledSessionTable label="Demo Session Table (Animated)" variant="secondary" />
            </DemoSessionStoreProvider>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Animation Sequence</CardTitle>
            <CardDescription>
              Current sequence: {sequenceType === 'basic' ? 'Basic session loading' : 'Status changes'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="text-xs bg-muted p-3 rounded overflow-x-auto">
              {JSON.stringify(sequence, null, 2)}
            </pre>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Demo Features</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div>
              <h3 className="font-semibold mb-1">Session Table Integration:</h3>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>Full session table with search and filtering</li>
                <li>Real-time status updates and animations</li>
                <li>Keyboard navigation and focus management</li>
                <li>Responsive design for different screen sizes</li>
              </ul>
            </div>

            <div>
              <h3 className="font-semibold mb-1">Demo Store Features:</h3>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>Automated session loading and status transitions</li>
                <li>Configurable animation sequences via JSON</li>
                <li>Theme switching for different visual presentations</li>
                <li>Perfect for product demos and screenshots</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}