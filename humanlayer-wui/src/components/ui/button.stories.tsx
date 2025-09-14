import type { Meta, StoryObj } from '@storybook/react'
import { Button } from './button'
import { RefreshCw, AlertCircle } from 'lucide-react'

const meta = {
  title: 'UI/Button',
  component: Button,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
} satisfies Meta<typeof Button>

export default meta
type Story = StoryObj<typeof meta>

// Basic button with text
export const Default: Story = {
  args: {
    children: 'EXECUTE',
    variant: 'default',
    size: 'default',
  },
}

// All variants showcase
export const AllVariants: Story = {
  parameters: {
    layout: 'centered',
  },
  render: () => (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2 items-center">
        <Button variant="default">DEFAULT</Button>
        <Button variant="destructive">DESTRUCTIVE</Button>
        <Button variant="outline">OUTLINE</Button>
        <Button variant="secondary">SECONDARY</Button>
        <Button variant="ghost">GHOST</Button>
        <Button variant="link">LINK</Button>
      </div>
    </div>
  ),
}

// All sizes showcase
export const AllSizes: Story = {
  parameters: {
    layout: 'centered',
  },
  render: () => (
    <div className="flex gap-2 items-center">
      <Button size="lg">LARGE</Button>
      <Button size="default">DEFAULT</Button>
      <Button size="sm">SMALL</Button>
      <Button size="icon">
        <RefreshCw className="h-4 w-4" />
      </Button>
    </div>
  ),
}

// Button with icon
export const WithIcon: Story = {
  parameters: {
    layout: 'centered',
  },
  render: () => (
    <div className="flex gap-2">
      <Button>
        <RefreshCw className="mr-2 h-4 w-4" />
        REFRESH
      </Button>
      <Button variant="destructive">
        <AlertCircle className="mr-2 h-4 w-4" />
        DELETE
      </Button>
    </div>
  ),
}

// Loading state
export const LoadingState: Story = {
  parameters: {
    layout: 'centered',
  },
  render: () => (
    <div className="flex gap-2">
      <Button disabled>PROCESSING...</Button>
      <Button disabled>
        <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
        LOADING
      </Button>
    </div>
  ),
}

// Terminal style showcase
export const TerminalStyle: Story = {
  parameters: {
    layout: 'centered',
  },
  render: () => (
    <div className="flex flex-col gap-4 p-4 bg-background text-foreground font-mono">
      <div className="text-xs text-muted-foreground mb-2">&gt; SELECT ACTION:</div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm">
          [Y] APPROVE
        </Button>
        <Button variant="destructive" size="sm">
          [N] DENY
        </Button>
        <Button variant="ghost" size="sm">
          [ESC] CANCEL
        </Button>
      </div>
      <div className="text-xs text-muted-foreground mt-2">&gt; AWAITING INPUT_</div>
    </div>
  ),
}
