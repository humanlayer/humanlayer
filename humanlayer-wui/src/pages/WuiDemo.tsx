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
import { SessionLauncher } from '@/components/SessionLauncher'
import { createDemoAppStore, DemoAppAnimator, AppAnimationStep } from '@/stores/demoAppStore'

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


// Context for demo app store
const DemoAppStoreContext = createContext<StoreApi<any> | null>(null)

// Hook to use the demo app store
function useDemoAppStore<T>(selector: (state: any) => T): T {
  const store = useContext(DemoAppStoreContext)
  if (!store) throw new Error('useDemoAppStore must be used within a DemoAppStoreProvider')
  return useStore(store, selector)
}

// Provider for demo app store with animation sequence
interface DemoAppStoreProviderProps {
  children: React.ReactNode
  sequence: AppAnimationStep[]
}

function DemoAppStoreProvider({ children, sequence }: DemoAppStoreProviderProps) {
  const [demoStore] = useState(() => createDemoAppStore(true))
  const [animator] = useState(() => new DemoAppAnimator(demoStore, sequence))

  useEffect(() => {
    // Initialize with basic app state
    demoStore.setState({
      sessions: [],
      focusedSession: null,
      launcherOpen: false,
      connected: true,
      status: 'Connected! Daemon @ v1.0.0',
      theme: 'solarized-dark'
    })

    animator.start()

    return () => {
      animator.stop()
    }
  }, [animator, demoStore, sequence])

  return <DemoAppStoreContext.Provider value={demoStore}>{children}</DemoAppStoreContext.Provider>
}

// Session table component wrapper
function SessionTableWrapper() {
  const searchQuery = useDemoAppStore(state => state.searchQuery)
  const setSearchQuery = useDemoAppStore(state => state.setSearchQuery)
  const sessions = useDemoAppStore(state => state.sessions)
  const focusedSession = useDemoAppStore(state => state.focusedSession)
  const setFocusedSession = useDemoAppStore(state => state.setFocusedSession)

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

// Launcher wrapper that uses demo store
function LauncherWrapper() {
  const isOpen = useDemoAppStore(state => state.launcherOpen)
  const setOpen = useDemoAppStore(state => state.setLauncherOpen)

  return <SessionLauncher isOpen={isOpen} onClose={() => setOpen(false)} />
}

// Complete app wrapper with session table and launcher
function DemoAppWrapper({ label, variant }: { label: string; variant: 'default' | 'secondary' }) {
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
      <LauncherWrapper />
    </div>
  )
}

// Comprehensive demo sequences with launcher and full app state
const launcherWorkflowSequence: AppAnimationStep[] = [
  {
    state: { sessions: [] },
    delay: 1000,
    description: "Start with empty sessions"
  },
  {
    state: { launcherOpen: true, launcherView: 'menu' },
    delay: 2000,
    description: "Open launcher command palette"
  },
  {
    state: { launcherView: 'input', launcherQuery: '' },
    delay: 1500,
    description: "Switch to input view"
  },
  {
    state: { launcherQuery: 'Help me debug this React component' },
    delay: 2000,
    description: "Type in query"
  },
  {
    state: { launcherIsLaunching: true },
    delay: 1000,
    description: "Start launching session"
  },
  {
    state: {
      launcherOpen: false,
      launcherIsLaunching: false,
      launcherQuery: '',
      sessions: [mockSessions[0]]
    },
    delay: 2000,
    description: "Session created, launcher closed"
  },
  {
    state: { sessions: mockSessions.slice(0, 2) },
    delay: 2000,
    description: "Add another session"
  },
  {
    state: {
      sessions: mockSessions.slice(0, 2).map(s =>
        s.id === 'session-1' ? { ...s, status: SessionStatus.Completed } : s
      )
    },
    delay: 2000,
    description: "Complete first session"
  },
  {
    state: { sessions: [] },
    delay: 3000,
    description: "Reset for loop"
  },
]

const themeShowcaseSequence: AppAnimationStep[] = [
  {
    state: { sessions: mockSessions, theme: 'solarized-dark' },
    delay: 1000,
    description: "Start with solarized dark"
  },
  {
    state: { theme: 'solarized-light' },
    delay: 2000,
    description: "Switch to solarized light"
  },
  {
    state: { theme: 'catppuccin' },
    delay: 2000,
    description: "Switch to catppuccin"
  },
  {
    state: { theme: 'framer-dark' },
    delay: 2000,
    description: "Switch to framer dark"
  },
  {
    state: { theme: 'gruvbox-dark' },
    delay: 2000,
    description: "Switch to gruvbox dark"
  },
  {
    state: { theme: 'solarized-dark' },
    delay: 3000,
    description: "Reset to solarized dark"
  },
]

const statusWorkflowSequence: AppAnimationStep[] = [
  {
    state: { sessions: mockSessions },
    delay: 1000,
    description: "Show all sessions"
  },
  {
    state: {
      sessions: mockSessions.map(s =>
        s.id === 'session-1' ? { ...s, status: SessionStatus.WaitingInput } : s
      )
    },
    delay: 2000,
    description: "Session 1 waiting for input"
  },
  {
    state: {
      sessions: mockSessions.map(s =>
        s.id === 'session-1' ? { ...s, status: SessionStatus.Completed } : s
      )
    },
    delay: 2000,
    description: "Session 1 completed"
  },
  {
    state: {
      sessions: mockSessions.map(s =>
        s.id === 'session-2' ? { ...s, status: SessionStatus.Running } : s
      )
    },
    delay: 1500,
    description: "Session 2 now running"
  },
  {
    state: { sessions: mockSessions },
    delay: 3000,
    description: "Reset status changes"
  },
]

// Main demo page
export default function WuiDemo() {
  const [sequenceType, setSequenceType] = useState<'launcher' | 'status' | 'themes'>('launcher')

  const sequence = sequenceType === 'launcher'
    ? launcherWorkflowSequence
    : sequenceType === 'status'
    ? statusWorkflowSequence
    : themeShowcaseSequence

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
            onClick={() => setSequenceType('launcher')}
            variant={sequenceType === 'launcher' ? 'default' : 'outline'}
            size="sm"
          >
            Launcher Workflow
          </Button>
          <Button
            onClick={() => setSequenceType('status')}
            variant={sequenceType === 'status' ? 'default' : 'outline'}
            size="sm"
          >
            Status Changes
          </Button>
          <Button
            onClick={() => setSequenceType('themes')}
            variant={sequenceType === 'themes' ? 'default' : 'outline'}
            size="sm"
          >
            Theme Showcase
          </Button>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Theme:</span>
            <ThemeSelector />
          </div>
        </div>

        <div className="flex justify-center">
          <div className="w-full max-w-4xl">
            <DemoAppStoreProvider sequence={sequence} key={sequenceType}>
              <DemoAppWrapper label="Complete WUI Demo with Launcher" variant="secondary" />
            </DemoAppStoreProvider>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Animation Sequence</CardTitle>
            <CardDescription>
              Current sequence: {
                sequenceType === 'launcher'
                  ? 'Complete launcher workflow with session creation'
                  : sequenceType === 'status'
                  ? 'Session status transitions'
                  : 'Theme switching demonstration'
              }
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
