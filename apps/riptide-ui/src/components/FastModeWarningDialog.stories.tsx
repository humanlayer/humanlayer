import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import { FastModeToggle } from '@humanlayer/ui/components/fast-mode-toggle'
import { FastModeWarningDialog } from './FastModeWarningDialog'

const meta: Meta<typeof FastModeWarningDialog> = {
  title: 'UI/FastModeWarningDialog',
  component: FastModeWarningDialog,
  parameters: {
    layout: 'centered',
  },
}
export default meta
type Story = StoryObj<typeof FastModeWarningDialog>

export const Open: Story = {
  args: {
    open: true,
    onOpenChange: () => {},
    onConfirm: () => {},
  },
}

export const Closed: Story = {
  args: {
    open: false,
    onOpenChange: () => {},
    onConfirm: () => {},
  },
}

// Shell Demo — exercises the full first-enable flow:
// first click opens modal; Cancel keeps toggle off; Enable Fast Mode commits and sets acknowledged flag
export const FastModeWarningFlowWrapper: StoryObj = {
  render: () => {
    const [enabled, setEnabled] = useState(false)
    const [dialogOpen, setDialogOpen] = useState(false)
    const [acknowledged, setAcknowledged] = useState(false)

    const handleToggle = (next: boolean) => {
      if (next && !acknowledged) {
        setDialogOpen(true)
        return
      }
      setEnabled(next)
    }

    const handleConfirm = () => {
      setAcknowledged(true)
      setEnabled(true)
      setDialogOpen(false)
    }

    return (
      <div className="flex flex-col gap-4 items-center">
        <FastModeToggle enabled={enabled} onToggle={handleToggle} />
        <div className="text-xs text-muted-foreground font-mono space-y-1 text-center">
          <div>Fast Mode: <span className="font-semibold">{enabled ? 'Enabled' : 'Disabled'}</span></div>
          <div>Warning acknowledged: <span className="font-semibold">{acknowledged ? 'Yes' : 'No'}</span></div>
          {acknowledged && (
            <div className="text-[var(--terminal-warning)]">
              Subsequent toggles will not re-open the modal
            </div>
          )}
        </div>
        <FastModeWarningDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onConfirm={handleConfirm}
        />
      </div>
    )
  },
}
FastModeWarningFlowWrapper.storyName = 'Shell Demo — First Enable Flow'
