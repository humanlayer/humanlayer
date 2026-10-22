import type { Meta, StoryObj } from '@storybook/react'
import { IterateInNewSessionButton } from './iterate-in-new-session-button'

const meta = {
  title: 'UI/ActionButtons/IterateInNewSessionButton',
  component: IterateInNewSessionButton,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof IterateInNewSessionButton>

export default meta
type Story = StoryObj<typeof meta>

export const AllStates: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <IterateInNewSessionButton isNarrow={false} onIterateInNewSession={() => {}} />
        <span className="text-sm text-muted-foreground">Wide (labeled)</span>
      </div>
      <div className="flex items-center gap-3">
        <IterateInNewSessionButton isNarrow={true} onIterateInNewSession={() => {}} />
        <span className="text-sm text-muted-foreground">Narrow (short label)</span>
      </div>
      <div className="flex items-center gap-3">
        <IterateInNewSessionButton isNarrow={true} isIconOnly onIterateInNewSession={() => {}} />
        <span className="text-sm text-muted-foreground">Very narrow (icon only)</span>
      </div>
      <div className="flex items-center gap-3">
        <IterateInNewSessionButton isNarrow={false} disabled onIterateInNewSession={() => {}} />
        <span className="text-sm text-muted-foreground">Wide disabled</span>
      </div>
      <div className="flex items-center gap-3">
        <IterateInNewSessionButton isNarrow={true} disabled onIterateInNewSession={() => {}} />
        <span className="text-sm text-muted-foreground">Narrow disabled</span>
      </div>
    </div>
  ),
}
