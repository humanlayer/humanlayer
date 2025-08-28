import type { Meta, StoryObj } from '@storybook/react'
import { Badge } from './badge'
import { CheckCircle, AlertTriangle, XCircle, User } from 'lucide-react'

const meta: Meta<typeof Badge> = {
  title: 'UI/Badge',
  component: Badge,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'secondary', 'destructive', 'outline'],
    },
    asChild: {
      control: 'boolean',
    },
  },
}

export default meta
type Story = StoryObj<typeof meta>

// Basic variants
export const Default: Story = {
  args: {
    children: 'Default',
  },
}

export const Secondary: Story = {
  args: {
    variant: 'secondary',
    children: 'Secondary',
  },
}

export const Destructive: Story = {
  args: {
    variant: 'destructive',
    children: 'Error',
  },
}

export const Outline: Story = {
  args: {
    variant: 'outline',
    children: 'Outline',
  },
}

// With icons
export const WithIconLeft: Story = {
  args: {
    children: (
      <>
        <CheckCircle className="h-3 w-3" />
        Success
      </>
    ),
  },
}

export const WithIconRight: Story = {
  args: {
    children: (
      <>
        Active
        <CheckCircle className="h-3 w-3" />
      </>
    ),
  },
}

export const IconOnly: Story = {
  args: {
    children: <User className="h-3 w-3" />,
  },
}

// Status badges with icons
export const SuccessBadge: Story = {
  args: {
    variant: 'default',
    children: (
      <>
        <CheckCircle className="h-3 w-3" />
        Completed
      </>
    ),
  },
}

export const WarningBadge: Story = {
  args: {
    variant: 'secondary',
    children: (
      <>
        <AlertTriangle className="h-3 w-3" />
        Warning
      </>
    ),
  },
}

export const ErrorBadge: Story = {
  args: {
    variant: 'destructive',
    children: (
      <>
        <XCircle className="h-3 w-3" />
        Failed
      </>
    ),
  },
}

// Different content lengths
export const Short: Story = {
  args: {
    children: 'New',
  },
}

export const Medium: Story = {
  args: {
    children: 'In Progress',
  },
}

export const Long: Story = {
  args: {
    children: 'Very Long Badge Text',
  },
}

export const VeryLong: Story = {
  args: {
    children: 'This is an extremely long badge text that tests wrapping',
  },
}

// Numbers and counts
export const Count: Story = {
  args: {
    variant: 'secondary',
    children: '42',
  },
}

export const Notification: Story = {
  args: {
    variant: 'destructive',
    children: '3',
  },
}

// AsChild example (as clickable link)
export const AsLink: Story = {
  args: {
    asChild: true,
    variant: 'outline',
    children: <a href="#">Clickable Badge</a>,
  },
}

// All variants showcase
export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Badge variant="default">Default</Badge>
      <Badge variant="secondary">Secondary</Badge>
      <Badge variant="destructive">Destructive</Badge>
      <Badge variant="outline">Outline</Badge>
    </div>
  ),
}

// Status collection
export const StatusCollection: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Badge variant="default">
        <CheckCircle className="h-3 w-3" />
        Active
      </Badge>
      <Badge variant="secondary">
        <AlertTriangle className="h-3 w-3" />
        Pending
      </Badge>
      <Badge variant="destructive">
        <XCircle className="h-3 w-3" />
        Inactive
      </Badge>
      <Badge variant="outline">Draft</Badge>
    </div>
  ),
}

// Different sizes with content
export const VariousSizes: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Badge>S</Badge>
      <Badge>Medium</Badge>
      <Badge>Very Long Badge</Badge>
      <Badge>
        <User className="h-3 w-3" />
        With Icon
      </Badge>
      <Badge variant="secondary">42</Badge>
    </div>
  ),
}
