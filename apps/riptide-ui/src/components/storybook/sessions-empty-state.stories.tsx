import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from '@storybook/test'
import { SessionsEmptyState, type SessionsEmptyStateProps } from '../session-table/SessionsEmptyState'

const meta = {
  title: 'SessionTable/SessionsEmptyState',
  component: SessionsEmptyState as any,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  args: {
    onCreateSession: fn(),
    onOpenCommandPalette: fn(),
  },
  decorators: [
    (Story) => (
      <div className="w-[600px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<SessionsEmptyStateProps>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    modKey: 'Cmd',
  },
}

export const WindowsStyle: Story = {
  args: {
    modKey: 'Ctrl',
  },
}
