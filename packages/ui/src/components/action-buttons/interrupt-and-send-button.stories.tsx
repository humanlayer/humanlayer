import type { Meta, StoryObj } from '@storybook/react'
import { InterruptAndSendButton } from './interrupt-and-send-button'

const meta = {
  title: 'UI/ActionButtons/InterruptAndSendButton',
  component: InterruptAndSendButton,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof InterruptAndSendButton>

export default meta
type Story = StoryObj<typeof meta>

export const AllStates: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <InterruptAndSendButton isNarrow={false} onInterruptAndSend={() => {}} />
        <span className="text-sm text-muted-foreground">Wide (labeled)</span>
      </div>
      <div className="flex items-center gap-3">
        <InterruptAndSendButton isNarrow={true} onInterruptAndSend={() => {}} />
        <span className="text-sm text-muted-foreground">Narrow (icon-only)</span>
      </div>
      <div className="flex items-center gap-3">
        <InterruptAndSendButton isNarrow={false} disabled onInterruptAndSend={() => {}} />
        <span className="text-sm text-muted-foreground">Wide disabled</span>
      </div>
      <div className="flex items-center gap-3">
        <InterruptAndSendButton isNarrow={true} disabled onInterruptAndSend={() => {}} />
        <span className="text-sm text-muted-foreground">Narrow disabled</span>
      </div>
    </div>
  ),
}
