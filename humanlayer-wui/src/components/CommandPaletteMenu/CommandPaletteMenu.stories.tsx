import type { Meta, StoryObj } from '@storybook/react'
import { fn } from '@storybook/test'
import CommandPaletteMenu from './CommandPaletteMenu'

const meta: Meta<typeof CommandPaletteMenu> = {
  title: 'Components/CommandPaletteMenu',
  component: CommandPaletteMenu,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'A command palette menu component for quick navigation and session management.',
      },
    },
  },
  argTypes: {
    mode: {
      control: 'select',
      options: ['command', 'search'],
      description: 'The current mode of the command palette',
    },
    focusedSession: {
      control: false,
      description: 'Currently focused session for contextual actions',
    },
    onCreateSession: {
      action: 'create-session',
      description: 'Callback when creating a new session',
    },
    onSearchSessions: {
      action: 'search-sessions',
      description: 'Callback when searching sessions',
    },
  },
}

export default meta
type Story = StoryObj<typeof CommandPaletteMenu>

// Mock sessions for stories
const mockSessions = [
  {
    id: '1',
    summary: 'Implement authentication system',
    query: 'Help me implement user authentication with JWT tokens',
    model: 'claude-3-5-sonnet-20241022',
    archived: false,
  },
  {
    id: '2',
    summary: 'Debug React component rendering issues',
    query: 'My React component is not rendering properly when props change',
    model: 'claude-3-5-haiku-20241022',
    archived: false,
  },
]

// Command mode - showing create session options
export const CommandMode: Story = {
  args: {
    mode: 'command',
    focusedSession: null,
    onCreateSession: fn(),
    onSearchSessions: fn(),
    onArchiveSession: fn(),
    onUnarchiveSession: fn(),
  },
}

// Search mode - for finding existing sessions
export const SearchMode: Story = {
  args: {
    mode: 'search',
    focusedSession: null,
    sessions: mockSessions,
    onCreateSession: fn(),
    onSearchSessions: fn(),
    onArchiveSession: fn(),
    onUnarchiveSession: fn(),
  },
}

// With focused session - shows archive/unarchive options
export const WithFocusedSession: Story = {
  args: {
    mode: 'command',
    focusedSession: mockSessions[0],
    sessions: mockSessions,
    onCreateSession: fn(),
    onSearchSessions: fn(),
    onArchiveSession: fn(),
    onUnarchiveSession: fn(),
  },
}

// With archived focused session
export const WithArchivedSession: Story = {
  args: {
    mode: 'command',
    focusedSession: { ...mockSessions[0], archived: true },
    sessions: mockSessions,
    onCreateSession: fn(),
    onSearchSessions: fn(),
    onArchiveSession: fn(),
    onUnarchiveSession: fn(),
  },
}
