import type { Meta, StoryObj } from '@storybook/react'
import SessionTable from './SessionTable'
import { Session, SessionStatus } from '@/lib/daemon/types'

const meta = {
  title: 'Internal/SessionTable',
  component: SessionTable,
  parameters: {
    layout: 'fullscreen',
  },
  decorators: [
    Story => (
      <div className="p-4 h-screen">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SessionTable>

export default meta
type Story = StoryObj<typeof meta>

// Helper to create valid sessions
const createValidSession = (id: string, overrides?: Partial<Session>): Session => ({
  id,
  runId: `run-${id}`,
  status: SessionStatus.Running,
  query: 'Test query',
  createdAt: new Date(),
  lastActivityAt: new Date(),
  workingDir: '/Users/test/project',
  summary: `Test session ${id}`,
  model: 'claude-sonnet-4',
  archived: false,
  ...overrides,
})

// Basic working story
export const Default: Story = {
  args: {
    sessions: [
      createValidSession('1'),
      createValidSession('2', { status: SessionStatus.Completed }),
      createValidSession('3', { status: SessionStatus.Draft }),
    ],
    focusedSession: null,
  },
}

// Error boundary story - demonstrates error handling
export const ErrorBoundaryDemo: Story = {
  args: {} as any,
  render: () => {
    // Create a session that throws when the component tries to access properties during render
    const brokenSession = new Proxy(
      {
        id: 'broken-session',
        runId: 'broken-run',
        createdAt: new Date(),
        lastActivityAt: new Date(),
      },
      {
        get(target, prop) {
          // Throw error when component tries to access status during render
          if (prop === 'status') {
            throw new Error('Test error: Session table rendering failed')
          }
          return (target as any)[prop]
        },
      },
    ) as Session

    return <SessionTable sessions={[brokenSession]} focusedSession={null} />
  },
  parameters: {
    docs: {
      description: {
        story:
          'Demonstrates error boundary behavior by using a Proxy that throws when the component accesses properties during render. Shows the centered "session-detail" variant error UI with "Something went wrong" message and "Reload Sessions" button.',
      },
    },
  },
}
