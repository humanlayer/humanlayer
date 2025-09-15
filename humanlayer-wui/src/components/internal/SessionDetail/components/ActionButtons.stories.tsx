import type { Meta, StoryObj } from '@storybook/react'
import { ActionButtons } from './ActionButtons'
import { SessionStatus } from '@/lib/daemon/types'
import { TooltipProvider } from '@/components/ui/tooltip'

const meta = {
  title: 'Internal/SessionDetail/ActionButtons',
  component: ActionButtons,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  decorators: [
    Story => (
      <TooltipProvider>
        <Story />
      </TooltipProvider>
    ),
  ],
  argTypes: {
    sessionStatus: {
      control: 'select',
      options: Object.values(SessionStatus),
    },
    canFork: {
      control: 'boolean',
    },
    bypassEnabled: {
      control: 'boolean',
    },
    autoAcceptEnabled: {
      control: 'boolean',
    },
    isArchived: {
      control: 'boolean',
    },
    onToggleFork: { action: 'toggleFork' },
    onToggleBypass: { action: 'toggleBypass' },
    onToggleAutoAccept: { action: 'toggleAutoAccept' },
    onToggleArchive: { action: 'toggleArchive' },
  },
} satisfies Meta<typeof ActionButtons>

export default meta
type Story = StoryObj<typeof meta>

// Default state - all buttons enabled, nothing active
export const Default: Story = {
  args: {
    sessionId: 'session-1',
    canFork: true,
    bypassEnabled: false,
    autoAcceptEnabled: false,
    sessionStatus: SessionStatus.Running,
    isArchived: false,
    onToggleFork: () => console.log('Toggle fork'),
    onToggleBypass: () => console.log('Toggle bypass'),
    onToggleAutoAccept: () => console.log('Toggle auto-accept'),
    onToggleArchive: () => console.log('Toggle archive'),
  },
}

// Fork disabled state
export const ForkDisabled: Story = {
  args: {
    sessionId: 'session-2',
    canFork: false,
    bypassEnabled: false,
    autoAcceptEnabled: false,
    sessionStatus: SessionStatus.Completed,
    isArchived: false,
    onToggleFork: () => console.log('Toggle fork'),
    onToggleBypass: () => console.log('Toggle bypass'),
    onToggleAutoAccept: () => console.log('Toggle auto-accept'),
    onToggleArchive: () => console.log('Toggle archive'),
  },
}

// Bypass permissions enabled (dangerous state)
export const BypassEnabled: Story = {
  args: {
    sessionId: 'session-3',
    canFork: true,
    bypassEnabled: true,
    autoAcceptEnabled: false,
    sessionStatus: SessionStatus.Running,
    isArchived: false,
    onToggleFork: () => console.log('Toggle fork'),
    onToggleBypass: () => console.log('Toggle bypass'),
    onToggleAutoAccept: () => console.log('Toggle auto-accept'),
    onToggleArchive: () => console.log('Toggle archive'),
  },
}

// Auto-accept enabled
export const AutoAcceptEnabled: Story = {
  args: {
    sessionId: 'session-4',
    canFork: true,
    bypassEnabled: false,
    autoAcceptEnabled: true,
    sessionStatus: SessionStatus.Running,
    isArchived: false,
    onToggleFork: () => console.log('Toggle fork'),
    onToggleBypass: () => console.log('Toggle bypass'),
    onToggleAutoAccept: () => console.log('Toggle auto-accept'),
    onToggleArchive: () => console.log('Toggle archive'),
  },
}

// Both bypass and auto-accept enabled
export const BothEnabled: Story = {
  args: {
    sessionId: 'session-5',
    canFork: true,
    bypassEnabled: true,
    autoAcceptEnabled: true,
    sessionStatus: SessionStatus.Running,
    isArchived: false,
    onToggleFork: () => console.log('Toggle fork'),
    onToggleBypass: () => console.log('Toggle bypass'),
    onToggleAutoAccept: () => console.log('Toggle auto-accept'),
    onToggleArchive: () => console.log('Toggle archive'),
  },
}

// Archived session
export const ArchivedSession: Story = {
  args: {
    sessionId: 'session-6',
    canFork: true,
    bypassEnabled: false,
    autoAcceptEnabled: false,
    sessionStatus: SessionStatus.Completed,
    isArchived: true,
    onToggleFork: () => console.log('Toggle fork'),
    onToggleBypass: () => console.log('Toggle bypass'),
    onToggleAutoAccept: () => console.log('Toggle auto-accept'),
    onToggleArchive: () => console.log('Toggle archive'),
  },
}

// Active session (warning state for archive)
export const ActiveSessionWarning: Story = {
  args: {
    sessionId: 'session-7',
    canFork: true,
    bypassEnabled: false,
    autoAcceptEnabled: false,
    sessionStatus: SessionStatus.Running,
    isArchived: false,
    onToggleFork: () => console.log('Toggle fork'),
    onToggleBypass: () => console.log('Toggle bypass'),
    onToggleAutoAccept: () => console.log('Toggle auto-accept'),
    onToggleArchive: () => console.log('Toggle archive'),
  },
}

// Waiting for input state
export const WaitingInputState: Story = {
  args: {
    sessionId: 'session-8',
    canFork: true,
    bypassEnabled: false,
    autoAcceptEnabled: false,
    sessionStatus: SessionStatus.WaitingInput,
    isArchived: false,
    onToggleFork: () => console.log('Toggle fork'),
    onToggleBypass: () => console.log('Toggle bypass'),
    onToggleAutoAccept: () => console.log('Toggle auto-accept'),
    onToggleArchive: () => console.log('Toggle archive'),
  },
}

// Failed session state
export const FailedSession: Story = {
  args: {
    sessionId: 'session-9',
    canFork: true,
    bypassEnabled: false,
    autoAcceptEnabled: false,
    sessionStatus: SessionStatus.Failed,
    isArchived: false,
    onToggleFork: () => console.log('Toggle fork'),
    onToggleBypass: () => console.log('Toggle bypass'),
    onToggleAutoAccept: () => console.log('Toggle auto-accept'),
    onToggleArchive: () => console.log('Toggle archive'),
  },
}

// All states showcase
export const AllStates: Story = {
  args: {} as any, // Custom render provides all props
  parameters: {
    layout: 'padded',
  },
  render: () => (
    <div className="space-y-8">
      <div>
        <h3 className="text-sm font-medium mb-3">Default State</h3>
        <ActionButtons
          sessionId="demo-1"
          canFork={true}
          bypassEnabled={false}
          autoAcceptEnabled={false}
          sessionStatus={SessionStatus.Running}
          isArchived={false}
          onToggleFork={() => console.log('Toggle fork')}
          onToggleBypass={() => console.log('Toggle bypass')}
          onToggleAutoAccept={() => console.log('Toggle auto-accept')}
          onToggleArchive={() => console.log('Toggle archive')}
        />
      </div>

      <div>
        <h3 className="text-sm font-medium mb-3">Fork Disabled</h3>
        <ActionButtons
          sessionId="demo-2"
          canFork={false}
          bypassEnabled={false}
          autoAcceptEnabled={false}
          sessionStatus={SessionStatus.Completed}
          isArchived={false}
          onToggleFork={() => console.log('Toggle fork')}
          onToggleBypass={() => console.log('Toggle bypass')}
          onToggleAutoAccept={() => console.log('Toggle auto-accept')}
          onToggleArchive={() => console.log('Toggle archive')}
        />
      </div>

      <div>
        <h3 className="text-sm font-medium mb-3">Bypass Enabled (Red Warning)</h3>
        <ActionButtons
          sessionId="demo-3"
          canFork={true}
          bypassEnabled={true}
          autoAcceptEnabled={false}
          sessionStatus={SessionStatus.Running}
          isArchived={false}
          onToggleFork={() => console.log('Toggle fork')}
          onToggleBypass={() => console.log('Toggle bypass')}
          onToggleAutoAccept={() => console.log('Toggle auto-accept')}
          onToggleArchive={() => console.log('Toggle archive')}
        />
      </div>

      <div>
        <h3 className="text-sm font-medium mb-3">Auto-Accept Enabled (Yellow Warning)</h3>
        <ActionButtons
          sessionId="demo-4"
          canFork={true}
          bypassEnabled={false}
          autoAcceptEnabled={true}
          sessionStatus={SessionStatus.Running}
          isArchived={false}
          onToggleFork={() => console.log('Toggle fork')}
          onToggleBypass={() => console.log('Toggle bypass')}
          onToggleAutoAccept={() => console.log('Toggle auto-accept')}
          onToggleArchive={() => console.log('Toggle archive')}
        />
      </div>

      <div>
        <h3 className="text-sm font-medium mb-3">Both Enabled</h3>
        <ActionButtons
          sessionId="demo-5"
          canFork={true}
          bypassEnabled={true}
          autoAcceptEnabled={true}
          sessionStatus={SessionStatus.Running}
          isArchived={false}
          onToggleFork={() => console.log('Toggle fork')}
          onToggleBypass={() => console.log('Toggle bypass')}
          onToggleAutoAccept={() => console.log('Toggle auto-accept')}
          onToggleArchive={() => console.log('Toggle archive')}
        />
      </div>

      <div>
        <h3 className="text-sm font-medium mb-3">Archived Session</h3>
        <ActionButtons
          sessionId="demo-6"
          canFork={true}
          bypassEnabled={false}
          autoAcceptEnabled={false}
          sessionStatus={SessionStatus.Completed}
          isArchived={true}
          onToggleFork={() => console.log('Toggle fork')}
          onToggleBypass={() => console.log('Toggle bypass')}
          onToggleAutoAccept={() => console.log('Toggle auto-accept')}
          onToggleArchive={() => console.log('Toggle archive')}
        />
      </div>

      <div>
        <h3 className="text-sm font-medium mb-3">Active Session (Archive shows warning)</h3>
        <ActionButtons
          sessionId="demo-7"
          canFork={true}
          bypassEnabled={false}
          autoAcceptEnabled={false}
          sessionStatus={SessionStatus.Running}
          isArchived={false}
          onToggleFork={() => console.log('Toggle fork')}
          onToggleBypass={() => console.log('Toggle bypass')}
          onToggleAutoAccept={() => console.log('Toggle auto-accept')}
          onToggleArchive={() => console.log('Toggle archive')}
        />
      </div>
    </div>
  ),
}

// Interactive playground
export const Interactive: Story = {
  args: {
    sessionId: 'interactive',
    canFork: true,
    bypassEnabled: false,
    autoAcceptEnabled: false,
    sessionStatus: SessionStatus.Running,
    isArchived: false,
    onToggleFork: () => console.log('Toggle fork'),
    onToggleBypass: () => console.log('Toggle bypass'),
    onToggleAutoAccept: () => console.log('Toggle auto-accept'),
    onToggleArchive: () => console.log('Toggle archive'),
  },
}
