import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { PermissionModeButton, type PermissionModeButtonProps } from './permission-mode-button'
import type { PermissionsMode } from '../../constants/permission-modes'

function StatefulWrapper(
  props: Omit<PermissionModeButtonProps, 'onValueChange' | 'value'> & {
    initialValue: PermissionsMode
  },
) {
  const { initialValue, ...rest } = props
  const [value, setValue] = useState<PermissionsMode>(initialValue)
  return <PermissionModeButton value={value} onValueChange={setValue} {...rest} />
}

const meta: Meta<typeof StatefulWrapper> = {
  title: 'Shell Demos/PermissionModeButton',
  component: StatefulWrapper,
  parameters: {
    layout: 'centered',
  },
}

export default meta

type Story = StoryObj<typeof StatefulWrapper>

export const Default: Story = { args: { initialValue: 'default' } }
export const AcceptEdits: Story = { args: { initialValue: 'accept_edits' } }
export const Auto: Story = { args: { initialValue: 'auto' } }
export const BypassDisplaysDefault: Story = { args: { initialValue: 'bypass' } }
export const WithShortcut: Story = {
  args: { initialValue: 'accept_edits', showShortcut: true },
}
export const Disabled: Story = {
  args: {
    initialValue: 'default',
    disabled: true,
    disabledTooltip: 'Available only for Claude Code sessions',
  },
}
