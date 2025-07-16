import { DemoAnimationStep } from '../composedDemoStore'
import { SessionStatus } from '@/lib/daemon/types'
import type { SessionInfo } from '@/lib/daemon/types'

// Helper to create realistic session data
function createMockSession(
  id: string, 
  query: string, 
  status: SessionStatus,
  overrides: Partial<SessionInfo> = {}
): SessionInfo {
  const now = new Date()
  return {
    id,
    run_id: `run-${id}`,
    claude_session_id: status !== SessionStatus.Starting ? `claude-${id}` : undefined,
    status,
    start_time: now.toISOString(),
    last_activity_at: now.toISOString(),
    query,
    summary: query,
    model: 'claude-3-5-sonnet-20241022',
    working_dir: '/home/user/project',
    ...overrides
  }
}

// Basic launcher workflow - showing session creation
export const launcherWorkflowSequence: DemoAnimationStep[] = [
  {
    sessionState: { sessions: [] },
    appState: { currentRoute: '/' },
    delay: 1000,
    description: "Start with empty session table"
  },
  {
    launcherState: { isOpen: true, mode: 'command', view: 'menu' },
    delay: 1500,
    description: "Open launcher with Cmd+K"
  },
  {
    launcherState: { view: 'input' },
    delay: 1000,
    description: "Switch to input view"
  },
  {
    launcherState: { query: 'Help me debug this React component' },
    delay: 2000,
    description: "Type query"
  },
  {
    launcherState: { isLaunching: true },
    delay: 500,
    description: "Start launching"
  },
  {
    launcherState: { 
      isOpen: false, 
      isLaunching: false, 
      query: '', 
      view: 'menu' 
    },
    sessionState: { 
      sessions: [
        createMockSession('1', 'Help me debug this React component', SessionStatus.Starting)
      ] 
    },
    delay: 1500,
    description: "Session created successfully"
  },
  {
    sessionState: { 
      sessions: [
        createMockSession('1', 'Help me debug this React component', SessionStatus.Running)
      ] 
    },
    delay: 2000,
    description: "Session is now running"
  },
  {
    sessionState: { 
      sessions: [
        createMockSession('1', 'Help me debug this React component', SessionStatus.Completed)
      ] 
    },
    delay: 3000,
    description: "Session completed"
  }
]

// Status changes demonstration
export const statusChangesSequence: DemoAnimationStep[] = [
  {
    sessionState: { 
      sessions: [
        createMockSession('1', 'Implement user authentication', SessionStatus.Running),
        createMockSession('2', 'Write unit tests', SessionStatus.Starting),
        createMockSession('3', 'Refactor database schema', SessionStatus.Completed)
      ] 
    },
    delay: 1000,
    description: "Multiple sessions in different states"
  },
  {
    sessionState: { 
      sessions: [
        createMockSession('1', 'Implement user authentication', SessionStatus.WaitingInput),
        createMockSession('2', 'Write unit tests', SessionStatus.Running),
        createMockSession('3', 'Refactor database schema', SessionStatus.Completed)
      ] 
    },
    delay: 2000,
    description: "First session needs approval"
  },
  {
    appState: {
      approvals: [{
        id: 'approval-1',
        title: 'Update authentication config',
        status: 'pending'
      }]
    },
    delay: 1000,
    description: "Approval appears"
  },
  {
    sessionState: { 
      sessions: [
        createMockSession('1', 'Implement user authentication', SessionStatus.Running),
        createMockSession('2', 'Write unit tests', SessionStatus.Running),
        createMockSession('3', 'Refactor database schema', SessionStatus.Completed)
      ] 
    },
    appState: { approvals: [] },
    delay: 2000,
    description: "Approval handled, session continues"
  },
  {
    sessionState: { 
      sessions: [
        createMockSession('1', 'Implement user authentication', SessionStatus.Completed),
        createMockSession('2', 'Write unit tests', SessionStatus.Completed),
        createMockSession('3', 'Refactor database schema', SessionStatus.Completed)
      ] 
    },
    delay: 2000,
    description: "All sessions completed"
  }
]

// Theme showcase sequence
export const themeShowcaseSequence: DemoAnimationStep[] = [
  {
    sessionState: { 
      sessions: [
        createMockSession('1', 'Build new feature', SessionStatus.Running),
        createMockSession('2', 'Fix production bug', SessionStatus.WaitingInput),
        createMockSession('3', 'Update documentation', SessionStatus.Completed),
        createMockSession('4', 'Optimize performance', SessionStatus.Failed, { 
          error: 'Connection timeout' 
        })
      ]
    },
    themeState: { theme: 'solarized-dark' },
    delay: 1000,
    description: "Start with solarized-dark"
  },
  {
    themeState: { theme: 'solarized-light' },
    delay: 2000,
    description: "Switch to solarized-light"
  },
  {
    themeState: { theme: 'catppuccin' },
    delay: 2000,
    description: "Switch to catppuccin"
  },
  {
    themeState: { theme: 'framer-dark' },
    delay: 2000,
    description: "Switch to framer-dark"
  },
  {
    themeState: { theme: 'gruvbox-dark' },
    delay: 2000,
    description: "Switch to gruvbox-dark"
  },
  {
    themeState: { theme: 'high-contrast' },
    delay: 2000,
    description: "Switch to high-contrast"
  },
  {
    themeState: { theme: 'solarized-dark' },
    delay: 2000,
    description: "Back to solarized-dark"
  }
]