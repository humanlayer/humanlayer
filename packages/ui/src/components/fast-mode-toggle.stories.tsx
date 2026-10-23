import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import { FastModeToggle } from './fast-mode-toggle'

const meta: Meta<typeof FastModeToggle> = {
  title: 'UI/FastModeToggle',
  component: FastModeToggle,
  parameters: {
    layout: 'centered',
  },
}
export default meta
type Story = StoryObj<typeof FastModeToggle>

export const Off: Story = {
  args: {
    enabled: false,
    onToggle: () => {},
  },
}

export const On: Story = {
  args: {
    enabled: true,
    onToggle: () => {},
  },
}

export const DisabledOff: Story = {
  args: {
    enabled: false,
    onToggle: () => {},
    disabled: true,
  },
}

export const DisabledOn: Story = {
  args: {
    enabled: true,
    onToggle: () => {},
    disabled: true,
  },
}

// Shell Demo — interactive toggle with local state
export const Interactive: StoryObj = {
  render: () => {
    const [enabled, setEnabled] = useState(false)
    return (
      <div className="flex flex-col gap-4 items-center">
        <FastModeToggle enabled={enabled} onToggle={setEnabled} />
        <div className="text-xs text-muted-foreground font-mono">
          Fast Mode is: <span className="font-semibold">{enabled ? 'Enabled' : 'Disabled'}</span>
        </div>
      </div>
    )
  },
}
Interactive.storyName = 'Shell Demo — Interactive'
