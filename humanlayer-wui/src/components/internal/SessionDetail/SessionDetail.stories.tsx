import type { Meta, StoryObj } from '@storybook/react'
import SessionDetailRouter from './SessionDetailRouter'
import { Session, SessionStatus } from '@/lib/daemon/types'
import { MemoryRouter } from 'react-router'

const meta = {
  title: 'Internal/SessionDetail',
  component: SessionDetailRouter,
  parameters: {
    layout: 'fullscreen',
  },
  decorators: [
    Story => (
      <MemoryRouter>
        <div className="h-screen w-full">
          <Story />
        </div>
      </MemoryRouter>
    ),
  ],
} satisfies Meta<typeof SessionDetailRouter>

export default meta
type Story = StoryObj<typeof meta>

// Helper to create valid session
const createValidSession = (id: string, overrides?: Partial<Session>): Session => ({
  id,
  runId: `run-${id}`,
  status: SessionStatus.Running,
  query: 'Implement user authentication feature',
  createdAt: new Date('2025-10-03T10:00:00Z'),
  lastActivityAt: new Date('2025-10-03T10:15:00Z'),
  workingDir: '/Users/test/project',
  summary: 'Working on user authentication',
  model: 'claude-sonnet-4',
  archived: false,
  ...overrides,
})

// Basic working story
export const Default: Story = {
  args: {
    session: createValidSession('session-1'),
    onClose: () => console.log('Close clicked'),
  },
}

// Completed session
export const Completed: Story = {
  args: {
    session: createValidSession('session-2', {
      status: SessionStatus.Completed,
      query: 'Fix bug in payment processing',
      summary: 'Fixed payment processing bug',
    }),
    onClose: () => console.log('Close clicked'),
  },
}

// Draft session
export const Draft: Story = {
  args: {
    session: createValidSession('session-3', {
      status: SessionStatus.Draft,
      query: 'Add dark mode support',
      summary: 'Draft: Dark mode implementation',
    }),
    onClose: () => console.log('Close clicked'),
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
        workingDir: '/test/path',
      },
      {
        get(target, prop) {
          // Throw error when component tries to access query during render
          if (prop === 'query') {
            throw new Error('Test error: SessionDetail rendering failed')
          }
          return (target as any)[prop]
        },
      },
    ) as Session

    return <SessionDetailRouter session={brokenSession} onClose={() => {}} />
  },
  parameters: {
    docs: {
      description: {
        story:
          'Demonstrates error boundary behavior by using a Proxy that throws when the component accesses properties during render. Shows the centered "session-detail" variant fallback UI with "Something went wrong" message and "Reload Session" button.',
      },
    },
  },
}
