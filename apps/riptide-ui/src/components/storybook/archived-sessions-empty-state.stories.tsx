import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from '@storybook/test'
import { ArchivedSessionsEmptyState, type ArchivedSessionsEmptyStateProps } from '../session-table/ArchivedSessionsEmptyState'

const meta = {
  title: 'Shell Demos/ArchivedSessionsEmptyState',
  component: ArchivedSessionsEmptyState as any,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  args: {
    onNavigateBack: fn(),
  },
  decorators: [
    (Story) => (
      <div className="w-[500px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<ArchivedSessionsEmptyStateProps>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
