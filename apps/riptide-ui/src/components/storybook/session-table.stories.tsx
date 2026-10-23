import type { Meta, StoryObj } from '@storybook/react-vite'
import { CodeLayerToaster } from '@humanlayer/ui/components/CodeLayerToaster'
import { SessionTableDemo } from './session-table'

const meta: Meta<typeof SessionTableDemo> = {
  title: 'Shell Demos/SessionTable',
  component: SessionTableDemo,
  decorators: [
    (Story) => (
      <div className="h-[600px] w-full">
        <Story />
        <CodeLayerToaster />
      </div>
    ),
  ],
  parameters: {
    layout: 'fullscreen',
  },
}

export default meta

type Story = StoryObj<typeof SessionTableDemo>

export const Default: Story = {
  args: {},
}

export const DraftsView: Story = {
  args: {
    isDraftsView: true,
  },
}

export const ArchivedView: Story = {
  args: {
    isArchivedView: true,
  },
}

export const EmptySessions: Story = {
  args: {
    initialSessions: [],
  },
}

export const EmptyArchived: Story = {
  args: {
    initialSessions: [],
    isArchivedView: true,
  },
}
