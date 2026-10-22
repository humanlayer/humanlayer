import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import { Button } from './button'
import { BypassPermissionsDialog } from './bypass-permissions-dialog'

const meta: Meta = {
  title: 'Shell Demos/BypassPermissionsDialog',
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj

// Interactive wrapper for stories
const DialogWrapper = ({ sessionCount }: { sessionCount?: number }) => {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open Bypass Dialog</Button>
      <BypassPermissionsDialog
        open={open}
        onOpenChange={setOpen}
        onConfirm={(minutes) => console.log('Confirmed with timeout:', minutes)}
        sessionCount={sessionCount}
      />
    </>
  )
}

export const Default: Story = {
  render: () => <DialogWrapper />,
}

export const MultipleSessions: Story = {
  render: () => <DialogWrapper sessionCount={5} />,
}
