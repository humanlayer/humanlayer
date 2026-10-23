import type { Meta, StoryObj } from '@storybook/react'
import { SessionActionButtons } from './session-action-buttons'

const meta = {
  title: 'UI/SessionActionButtons',
  component: SessionActionButtons,
  parameters: {
    layout: 'centered',
  },
} satisfies Meta<typeof SessionActionButtons>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    bypassEnabled: false,
    bypassTimeoutMinutes: null,
    onToggleBypass: () => console.log('Toggle bypass'),
    permissionsMode: 'default',
    onPermissionModeChange: (mode) => console.log('Permission mode change:', mode),
    isArchived: false,
    sessionStatus: 'ready_for_input',
    onToggleArchive: () => console.log('Toggle archive'),
  },
}

export const AcceptEdits: Story = {
  args: {
    ...Default.args,
    permissionsMode: 'accept_edits',
  },
}

export const Auto: Story = {
  args: {
    ...Default.args,
    permissionsMode: 'auto',
  },
}

export const NonClaudeHarness: Story = {
  args: {
    ...Default.args,
    codingAgent: 'codelayer',
    permissionsMode: 'default',
  },
}
