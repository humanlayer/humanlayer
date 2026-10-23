import type { Meta, StoryObj } from '@storybook/react'
import { InterruptButton } from './interrupt-button'

const meta = {
  title: 'UI/ActionButtons/InterruptButton',
  component: InterruptButton,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof InterruptButton>

export default meta
type Story = StoryObj<typeof meta>

export const AllStates: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <InterruptButton isNarrow={false} onInterrupt={() => {}} />
        <span className="text-sm text-muted-foreground">Wide (labeled)</span>
      </div>
      <div className="flex items-center gap-3">
        <InterruptButton isNarrow={true} onInterrupt={() => {}} />
        <span className="text-sm text-muted-foreground">Narrow (icon-only)</span>
      </div>
      <div className="flex items-center gap-3">
        <InterruptButton isNarrow={false} disabled onInterrupt={() => {}} />
        <span className="text-sm text-muted-foreground">Wide disabled</span>
      </div>
      <div className="flex items-center gap-3">
        <InterruptButton isNarrow={true} disabled onInterrupt={() => {}} />
        <span className="text-sm text-muted-foreground">Narrow disabled</span>
      </div>
    </div>
  ),
}
