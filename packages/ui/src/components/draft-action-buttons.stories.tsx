import type { Meta, StoryObj } from '@storybook/react'
import { DraftActionButtons } from './draft-action-buttons'

const meta = {
  title: 'UI/DraftActionButtons',
  component: DraftActionButtons,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
} satisfies Meta<typeof DraftActionButtons>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    bypassEnabled: false,
    bypassTimeoutConfiguredMinutes: null,
    onToggleBypass: () => console.log('Toggle bypass'),
    permissionsMode: 'default',
    onPermissionModeChange: (mode) => console.log('Permission mode change:', mode),
  },
}

export const BypassEnabled: Story = {
  args: {
    bypassEnabled: true,
    bypassTimeoutConfiguredMinutes: 15,
    onToggleBypass: () => console.log('Toggle bypass'),
    permissionsMode: 'default',
    onPermissionModeChange: (mode) => console.log('Permission mode change:', mode),
  },
}

export const BypassEnabledNoTimeout: Story = {
  args: {
    bypassEnabled: true,
    bypassTimeoutConfiguredMinutes: null,
    onToggleBypass: () => console.log('Toggle bypass'),
    permissionsMode: 'default',
    onPermissionModeChange: (mode) => console.log('Permission mode change:', mode),
  },
}

export const AcceptEdits: Story = {
  args: {
    bypassEnabled: false,
    bypassTimeoutConfiguredMinutes: null,
    onToggleBypass: () => console.log('Toggle bypass'),
    permissionsMode: 'accept_edits',
    onPermissionModeChange: (mode) => console.log('Permission mode change:', mode),
  },
}

export const Auto: Story = {
  args: {
    bypassEnabled: false,
    bypassTimeoutConfiguredMinutes: null,
    onToggleBypass: () => console.log('Toggle bypass'),
    permissionsMode: 'auto',
    onPermissionModeChange: (mode) => console.log('Permission mode change:', mode),
  },
}

export const NonClaudeHarness: Story = {
  args: {
    bypassEnabled: false,
    bypassTimeoutConfiguredMinutes: null,
    onToggleBypass: () => console.log('Toggle bypass'),
    permissionsMode: 'default',
    onPermissionModeChange: (mode) => console.log('Permission mode change:', mode),
    codingAgent: 'codelayer',
  },
}
