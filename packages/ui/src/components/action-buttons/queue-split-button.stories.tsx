import type { Meta, StoryObj } from '@storybook/react'
import { QueueSplitButton } from './queue-split-button'

const meta = {
  title: 'UI/ActionButtons/QueueSplitButton',
  component: QueueSplitButton,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof QueueSplitButton>

export default meta
type Story = StoryObj<typeof meta>

export const AllStates: Story = {
  render: () => (
    <div className="flex flex-col gap-6 w-96">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <QueueSplitButton
            onQueue={() => {}}
            onInterrupt={() => {}}
            onInterruptAndSend={() => {}}
          />
        </div>
        <span className="text-sm text-muted-foreground">Enabled</span>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <QueueSplitButton
            onQueue={() => {}}
            onInterrupt={() => {}}
            onInterruptAndSend={() => {}}
            disabled
          />
        </div>
        <span className="text-sm text-muted-foreground">Disabled</span>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <QueueSplitButton
            onQueue={() => {}}
            onInterrupt={() => {}}
            onInterruptAndSend={() => {}}
            queueShortcut="⌘⏎"
            interruptShortcut="⌃C"
            interruptAndSendShortcut="⌃⏎"
          />
        </div>
        <span className="text-sm text-muted-foreground">Custom shortcuts</span>
      </div>
    </div>
  ),
}
