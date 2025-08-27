// TODO: Enable when Storybook is properly configured and dependencies are installed
// import type { Meta, StoryObj } from '@storybook/react'
// import { Session, SessionStatus } from '@/lib/daemon/types'
// import SessionTable from './SessionTable'
// import { Search } from 'lucide-react'

// Storybook configuration - disabled until dependencies are installed
// const meta: Meta<typeof SessionTable> = {
//   title: 'Components/SessionTable',
//   component: SessionTable,
//   parameters: {
//     layout: 'fullscreen',
//     docs: {
//       description: {
//         component:
//           'A table component for displaying and managing AI assistant sessions with support for selection, editing, archiving, and keyboard navigation.',
//       },
//     },
//   },
//   argTypes: {
//     sessions: { control: false },
//     focusedSession: { control: false },
//     matchedSessions: { control: false },
//     emptyState: { control: false },
//   },
// }

// export default meta
// type Story = StoryObj<typeof SessionTable>

// Mock sessions for stories - available for future use
/*
const mockSessions: Session[] = [
  {
    id: 'session-1',
    runId: 'run-1',
    query: 'Help me refactor React components',
    summary: 'Working on React component refactoring',
    title: 'React Refactor',
    status: SessionStatus.Running,
    workingDir: '/home/user/projects/my-app',
    model: 'claude-3-sonnet-20241022',
    createdAt: new Date('2024-01-01T10:00:00Z'),
    lastActivityAt: new Date('2024-01-01T10:30:00Z'),
    archived: false,
    dangerouslySkipPermissions: false,
    autoAcceptEdits: false,
  },
  {
    id: 'session-2',
    runId: 'run-2',
    query: 'Debug API integration issues',
    summary: 'Debugging API integration issues with third-party service',
    title: 'API Debug Session',
    status: SessionStatus.Completed,
    workingDir: '/home/user/projects/api-client',
    model: 'claude-3-haiku-20240307',
    createdAt: new Date('2024-01-01T09:00:00Z'),
    lastActivityAt: new Date('2024-01-01T09:45:00Z'),
    archived: false,
    dangerouslySkipPermissions: false,
    autoAcceptEdits: true,
  },
  {
    id: 'session-3',
    runId: 'run-3',
    query: 'Migrate and optimize database schema',
    summary: 'Database schema migration and optimization',
    title: undefined,
    status: SessionStatus.Failed,
    workingDir: '/home/user/projects/database-work',
    model: 'claude-3-opus-20240229',
    createdAt: new Date('2024-01-01T08:00:00Z'),
    lastActivityAt: new Date('2024-01-01T08:15:00Z'),
    archived: true,
    dangerouslySkipPermissions: true,
    autoAcceptEdits: false,
  },
  {
    id: 'session-4',
    runId: 'run-4',
    query: 'Set up CI/CD pipeline',
    summary: 'Setting up CI/CD pipeline with GitHub Actions',
    title: 'CI/CD Setup',
    status: SessionStatus.WaitingInput,
    workingDir: '/home/user/projects/devops',
    model: undefined,
    createdAt: new Date('2024-01-01T07:00:00Z'),
    lastActivityAt: new Date('2024-01-01T07:30:00Z'),
    archived: false,
    dangerouslySkipPermissions: false,
    autoAcceptEdits: false,
  },
]
*/

// Stories are disabled until Storybook is configured - preserving structure for future use
/*
// Default story with multiple sessions
export const Default: Story = {
  args: {
    sessions: mockSessions,
    focusedSession: null,
    handleFocusSession: (session: Session) => console.log('Focus session:', session),
    handleBlurSession: () => console.log('Blur session'),
    handleFocusNextSession: () => console.log('Focus next session'),
    handleFocusPreviousSession: () => console.log('Focus previous session'),
    handleActivateSession: (session: Session) => console.log('Activate session:', session),
  },
}

// Story with focused session
export const WithFocusedSession: Story = {
  args: {
    ...Default.args,
    focusedSession: mockSessions[0],
  },
}

// Story showing search results with highlighting
export const WithSearchHighlighting: Story = {
  args: {
    ...Default.args,
    searchText: 'React',
    matchedSessions: new Map([
      [
        mockSessions[0].id,
        {
          matches: [{ key: 'summary', indices: [[11, 16]] }], // "React" in "Working on React component"
        },
      ],
    ]),
  },
}

// Empty state story
export const EmptyDefault: Story = {
  args: {
    ...Default.args,
    sessions: [],
  },
}

// Empty state with search
export const EmptyWithSearch: Story = {
  args: {
    ...Default.args,
    sessions: [],
    searchText: 'nonexistent query',
  },
}

// Custom empty state
export const EmptyCustom: Story = {
  args: {
    ...Default.args,
    sessions: [],
    emptyState: {
      icon: Search,
      title: 'No matching sessions',
      message: 'Try adjusting your search criteria or create a new session',
      action: {
        label: 'Create Session',
        onClick: () => console.log('Create new session'),
      },
    },
  },
}

// Story showing sessions with various statuses
export const VariousStatuses: Story = {
  args: {
    ...Default.args,
    sessions: [
      { ...mockSessions[0], status: SessionStatus.Running },
      { ...mockSessions[1], status: SessionStatus.Completed },
      { ...mockSessions[2], status: SessionStatus.Failed },
      { ...mockSessions[3], status: SessionStatus.WaitingInput },
    ],
  },
}

// Story showing archived sessions
export const WithArchivedSessions: Story = {
  args: {
    ...Default.args,
    sessions: mockSessions.map(session => ({ ...session, archived: true })),
  },
}

// Story showing dangerous permissions indicators
export const WithDangerousPermissions: Story = {
  args: {
    ...Default.args,
    sessions: mockSessions.map(session => ({
      ...session,
      dangerouslySkipPermissions: true,
    })),
  },
}

// Story showing auto-accept edits indicators
export const WithAutoAcceptEdits: Story = {
  args: {
    ...Default.args,
    sessions: mockSessions.map(session => ({
      ...session,
      autoAcceptEdits: true,
    })),
  },
}

// Story with mixed session states (some archived, some with special permissions)
export const MixedStates: Story = {
  args: {
    ...Default.args,
    sessions: [
      {
        ...mockSessions[0],
        archived: false,
        dangerouslySkipPermissions: false,
        autoAcceptEdits: false,
      },
      { ...mockSessions[1], archived: false, dangerouslySkipPermissions: false, autoAcceptEdits: true },
      { ...mockSessions[2], archived: true, dangerouslySkipPermissions: true, autoAcceptEdits: false },
      { ...mockSessions[3], archived: false, dangerouslySkipPermissions: true, autoAcceptEdits: true },
    ],
    focusedSession: mockSessions[1],
  },
}

// Story with very long working directory paths
export const LongPaths: Story = {
  args: {
    ...Default.args,
    sessions: [
      {
        ...mockSessions[0],
        workingDir:
          '/home/user/very/long/path/to/project/with/many/nested/directories/and/subdirectories/my-application',
      },
      {
        ...mockSessions[1],
        workingDir:
          '/Users/developer/Documents/Projects/Client Work/Very Important Client/Super Secret Project/backend-api-service',
      },
    ],
  },
}

// Story with missing model information
export const WithMissingModels: Story = {
  args: {
    ...Default.args,
    sessions: mockSessions.map(session => ({ ...session, model: null })),
  },
}
*/

// Export a placeholder to prevent module errors
export default {}
