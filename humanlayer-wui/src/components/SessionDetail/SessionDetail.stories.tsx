import type { Meta, StoryObj } from '@storybook/react'
import { fn } from '@storybook/test'
import { BrowserRouter } from 'react-router-dom'
import SessionDetail from './SessionDetail'
import { Session, SessionStatus } from '@/lib/daemon/types'

// Mock conversation events
const mockEvents = [
  {
    id: 'event-1',
    sessionId: 'session-1',
    eventType: 'message',
    role: 'user',
    content: 'Create a new React component for displaying user profiles',
    timestamp: new Date('2024-01-01T10:00:00Z'),
  },
  {
    id: 'event-2',
    sessionId: 'session-1',
    eventType: 'message',
    role: 'assistant',
    content:
      "I'll help you create a React component for displaying user profiles. Let me start by creating the component structure.",
    timestamp: new Date('2024-01-01T10:00:30Z'),
  },
  {
    id: 'event-3',
    sessionId: 'session-1',
    eventType: 'tool_call',
    toolName: 'Write',
    toolInput: JSON.stringify({
      file_path: '/components/UserProfile.tsx',
      content: 'export const UserProfile = () => { ... }',
    }),
    timestamp: new Date('2024-01-01T10:01:00Z'),
    approvalStatus: 'approved',
  },
]

// Sample sessions for different states
const mockCompletedSession: Session = {
  id: 'session-1',
  runId: 'run-1',
  title: 'Create User Profile Component',
  summary:
    'Building a reusable React component for displaying user profiles with avatar, name, and bio',
  query: 'Create a new React component for displaying user profiles',
  status: SessionStatus.Completed,
  archived: false,
  workingDir: '/Users/developer/projects/my-app',
  model: 'claude-3-sonnet-20240229',
  inputTokens: 1250,
  outputTokens: 850,
  contextLimit: 8000,
  autoAcceptEdits: false,
  dangerouslySkipPermissions: false,
  dangerouslySkipPermissionsExpiresAt: undefined,
  parentSessionId: undefined,
  createdAt: new Date('2024-01-01T10:00:00Z'),
  lastActivityAt: new Date('2024-01-01T11:00:00Z'),
}

const mockRunningSession: Session = {
  ...mockCompletedSession,
  id: 'session-2',
  runId: 'run-2',
  title: 'Refactor Authentication System',
  status: SessionStatus.Running,
  inputTokens: 2100,
  outputTokens: 450,
}

const mockArchivedSession: Session = {
  ...mockCompletedSession,
  id: 'session-3',
  runId: 'run-3',
  title: 'Fix Login Bug',
  archived: true,
  status: SessionStatus.Failed,
}

const mockChildSession: Session = {
  ...mockCompletedSession,
  id: 'session-4',
  runId: 'run-4',
  title: 'Continue Previous Work',
  parentSessionId: 'session-1',
  status: SessionStatus.WaitingInput,
}

const mockAutoAcceptSession: Session = {
  ...mockCompletedSession,
  id: 'session-5',
  runId: 'run-5',
  title: 'Auto-Accept Mode Demo',
  autoAcceptEdits: true,
  status: SessionStatus.Running,
}

// Decorator to provide mocks and router context
const withMocksAndRouter = (Story: any) => {
  // Mock global functions for Storybook
  if (typeof window !== 'undefined') {
    ;(globalThis as any).__storybookMocks = {
      ...((globalThis as any).__storybookMocks || {}),
      useConversation: () => ({
        events: mockEvents,
        isLoading: false,
        error: null,
      }),
      useStore: () => ({
        sessions: [],
        expandedToolResult: null,
        setExpandedToolResult: fn(),
        expandedToolCall: null,
        setExpandedToolCall: fn(),
        forkViewOpen: false,
        setForkViewOpen: fn(),
        dangerousSkipPermissionsDialogOpen: false,
        setDangerousSkipPermissionsDialogOpen: fn(),
        confirmingArchive: false,
        setConfirmingArchive: fn(),
        isEditingTitle: null,
        startTitleEdit: fn(),
        updateTitleEdit: fn(),
        saveTitleEdit: fn(),
        cancelTitleEdit: fn(),
        updateSessionOptimistic: fn(),
      }),
      useHotkeys: fn(),
      useHotkeysContext: () => ({
        enableScope: fn(),
        disableScope: fn(),
        activeScopes: [],
      }),
      toast: {
        error: fn(),
        success: fn(),
        warning: fn(),
      },
      daemonClient: {
        getSessionState: fn(() => Promise.resolve({ session: mockCompletedSession })),
      },
      logger: {
        log: fn(),
        warn: fn(),
        error: fn(),
      },
    }
  }

  return (
    <BrowserRouter>
      <div style={{ height: '100vh', width: '100vw' }}>
        <Story />
      </div>
    </BrowserRouter>
  )
}

const meta: Meta<typeof SessionDetail> = {
  title: 'Components/SessionDetail',
  component: SessionDetail,
  decorators: [withMocksAndRouter],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'A comprehensive session detail view showing conversation history, approvals, and session management controls.',
      },
    },
  },
  args: {
    onClose: fn(),
  },
  argTypes: {
    session: {
      description: 'The session object containing all session data',
    },
    onClose: {
      action: 'closed',
      description: 'Callback fired when the session detail view should close',
    },
  },
}

export default meta
type Story = StoryObj<typeof SessionDetail>

// Default story - completed session
export const Completed: Story = {
  args: {
    session: mockCompletedSession,
  },
}

// Running session with processing indicator
export const Running: Story = {
  args: {
    session: mockRunningSession,
  },
}

// Archived session
export const Archived: Story = {
  args: {
    session: mockArchivedSession,
  },
}

// Child session (continued from parent)
export const ChildSession: Story = {
  args: {
    session: mockChildSession,
  },
}

// Session with auto-accept mode enabled
export const AutoAcceptMode: Story = {
  args: {
    session: mockAutoAcceptSession,
  },
}

// Session with dangerous skip permissions
export const SkipPermissionsMode: Story = {
  args: {
    session: {
      ...mockCompletedSession,
      dangerouslySkipPermissions: true,
      dangerouslySkipPermissionsExpiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 minutes from now
    },
  },
}

// Long session title
export const LongTitle: Story = {
  args: {
    session: {
      ...mockCompletedSession,
      title:
        'This is a very long session title that should demonstrate how the UI handles lengthy titles and whether they wrap or truncate properly in the interface',
      workingDir: '/Users/developer/projects/very-long-project-name-that-might-overflow',
    },
  },
}

// Session without title (uses summary)
export const NoTitle: Story = {
  args: {
    session: {
      ...mockCompletedSession,
      title: '',
      summary: 'Session without a title - should fall back to summary text',
    },
  },
}

// Session with high token usage
export const HighTokenUsage: Story = {
  args: {
    session: {
      ...mockCompletedSession,
      inputTokens: 7200,
      outputTokens: 650,
      contextLimit: 8000,
    },
  },
}

// Waiting for input session
export const WaitingInput: Story = {
  args: {
    session: {
      ...mockCompletedSession,
      status: SessionStatus.WaitingInput,
      title: 'Pending Approval Required',
    },
  },
}

// Session with minimal information
export const MinimalInfo: Story = {
  args: {
    session: {
      ...mockCompletedSession,
      title: undefined,
      summary: '',
      model: undefined,
      inputTokens: undefined,
      outputTokens: undefined,
      contextLimit: undefined,
    },
  },
}

// Failed session
export const Failed: Story = {
  args: {
    session: {
      ...mockCompletedSession,
      status: SessionStatus.Failed,
      title: 'Failed Session Example',
      summary: 'This session encountered errors and could not complete successfully',
    },
  },
}
