import type { Meta, StoryObj } from '@storybook/react'
import { ArchiveButton } from './archive-button'

const meta = {
  title: 'UI/ActionButtons/ArchiveButton',
  component: ArchiveButton,
  parameters: {
    layout: 'centered',
  },
} satisfies Meta<typeof ArchiveButton>

export default meta
type Story = StoryObj<typeof meta>

export const AllStates: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <ArchiveButton isArchived={false} isActiveSession={false} onToggle={() => {}} />
        <span className="text-sm text-muted-foreground">Default (not archived, inactive)</span>
      </div>
      <div className="flex items-center gap-3">
        <ArchiveButton isArchived={true} isActiveSession={false} onToggle={() => {}} />
        <span className="text-sm text-muted-foreground">Archived</span>
      </div>
      <div className="flex items-center gap-3">
        <ArchiveButton isArchived={false} isActiveSession={true} onToggle={() => {}} />
        <span className="text-sm text-muted-foreground">Active session (warning color)</span>
      </div>
      <div className="flex items-center gap-3">
        <ArchiveButton isArchived={true} isActiveSession={true} onToggle={() => {}} />
        <span className="text-sm text-muted-foreground">Archived + active session</span>
      </div>
    </div>
  ),
}
