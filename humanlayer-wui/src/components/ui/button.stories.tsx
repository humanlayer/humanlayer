import type { Meta, StoryObj } from '@storybook/react'
import { fn } from '@storybook/test'
import { Button } from './button'
import { Download, Mail, Plus } from 'lucide-react'

const meta: Meta<typeof Button> = {
  title: 'UI/Button',
  component: Button,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'destructive', 'outline', 'secondary', 'ghost', 'link'],
    },
    size: {
      control: 'select',
      options: ['default', 'sm', 'lg', 'icon'],
    },
    disabled: {
      control: 'boolean',
    },
    asChild: {
      control: 'boolean',
    },
  },
  args: {
    onClick: fn(),
  },
}

export default meta
type Story = StoryObj<typeof meta>

// Basic variants
export const Default: Story = {
  args: {
    children: 'Default Button',
  },
}

export const Destructive: Story = {
  args: {
    variant: 'destructive',
    children: 'Delete',
  },
}

export const Outline: Story = {
  args: {
    variant: 'outline',
    children: 'Outline',
  },
}

export const Secondary: Story = {
  args: {
    variant: 'secondary',
    children: 'Secondary',
  },
}

export const Ghost: Story = {
  args: {
    variant: 'ghost',
    children: 'Ghost',
  },
}

export const Link: Story = {
  args: {
    variant: 'link',
    children: 'Link Button',
  },
}

// Size variants
export const Small: Story = {
  args: {
    size: 'sm',
    children: 'Small',
  },
}

export const Large: Story = {
  args: {
    size: 'lg',
    children: 'Large',
  },
}

export const Icon: Story = {
  args: {
    size: 'icon',
    children: <Plus className="h-4 w-4" />,
  },
}

// With icons
export const WithIcon: Story = {
  args: {
    children: (
      <>
        <Mail className="mr-2 h-4 w-4" />
        Login with Email
      </>
    ),
  },
}

export const IconRight: Story = {
  args: {
    children: (
      <>
        Download
        <Download className="ml-2 h-4 w-4" />
      </>
    ),
  },
}

// States
export const Disabled: Story = {
  args: {
    disabled: true,
    children: 'Disabled',
  },
}

export const DisabledWithIcon: Story = {
  args: {
    disabled: true,
    children: (
      <>
        <Mail className="mr-2 h-4 w-4" />
        Disabled with Icon
      </>
    ),
  },
}

// Loading state (simulated with disabled)
export const Loading: Story = {
  args: {
    disabled: true,
    children: (
      <>
        <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
        Loading...
      </>
    ),
  },
}

// Combination examples
export const DestructiveOutline: Story = {
  args: {
    variant: 'destructive',
    children: 'Delete Account',
  },
}

export const SmallGhost: Story = {
  args: {
    variant: 'ghost',
    size: 'sm',
    children: 'Small Ghost',
  },
}

export const LargeSecondary: Story = {
  args: {
    variant: 'secondary',
    size: 'lg',
    children: 'Large Secondary',
  },
}

// All variants showcase
export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-wrap gap-4">
      <Button variant="default">Default</Button>
      <Button variant="destructive">Destructive</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="link">Link</Button>
    </div>
  ),
}

// All sizes showcase
export const AllSizes: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <Button size="sm">Small</Button>
      <Button size="default">Default</Button>
      <Button size="lg">Large</Button>
      <Button size="icon">
        <Plus className="h-4 w-4" />
      </Button>
    </div>
  ),
}

// AsChild example (simulated)
export const AsChild: Story = {
  args: {
    asChild: true,
    children: <a href="#">Link as Button</a>,
  },
}
