import type { Meta, StoryObj } from '@storybook/react'
import { fn } from '@storybook/test'
import { Popover, PopoverContent, PopoverTrigger } from './popover'
import { Button } from './button'
import { Input } from './input'
import { Label } from './label'
import { Settings, User, HelpCircle, MoreVertical, Filter } from 'lucide-react'

const meta: Meta<typeof Popover> = {
  title: 'UI/Popover',
  component: Popover,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  argTypes: {
    open: {
      control: 'boolean',
    },
  },
  args: {
    onOpenChange: fn(),
  },
}

export default meta
type Story = StoryObj<typeof meta>

// Basic popover
export const Default: Story = {
  render: args => (
    <Popover {...args}>
      <PopoverTrigger asChild>
        <Button variant="outline">Open Popover</Button>
      </PopoverTrigger>
      <PopoverContent>
        <div className="space-y-2">
          <h4 className="font-medium leading-none">Popover Content</h4>
          <p className="text-sm text-muted-foreground">
            This is the content inside the popover. It can contain any React elements.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  ),
}

// Simple info popover
export const InfoPopover: Story = {
  render: args => (
    <Popover {...args}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon">
          <HelpCircle className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent>
        <div className="space-y-2">
          <h4 className="font-medium">Help Information</h4>
          <p className="text-sm text-muted-foreground">
            Click here to get more information about this feature.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  ),
}

// Form in popover
export const FormPopover: Story = {
  render: args => (
    <Popover {...args}>
      <PopoverTrigger asChild>
        <Button>
          <User className="mr-2 h-4 w-4" />
          Edit Profile
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80">
        <div className="space-y-4">
          <div className="space-y-2">
            <h4 className="font-medium leading-none">Edit Profile</h4>
            <p className="text-sm text-muted-foreground">Update your profile information.</p>
          </div>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="name">Name</Label>
              <Input id="name" defaultValue="John Doe" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="email">Email</Label>
              <Input id="email" defaultValue="john@example.com" />
            </div>
            <div className="flex justify-end space-x-2">
              <Button variant="outline" size="sm">
                Cancel
              </Button>
              <Button size="sm">Save</Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  ),
}

// Settings menu popover
export const SettingsMenu: Story = {
  render: args => (
    <Popover {...args}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon">
          <Settings className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56">
        <div className="space-y-1">
          <div className="px-2 py-1.5">
            <h4 className="font-medium">Settings</h4>
          </div>
          <div className="space-y-1">
            <button className="w-full px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground rounded">
              Profile Settings
            </button>
            <button className="w-full px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground rounded">
              Preferences
            </button>
            <button className="w-full px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground rounded">
              Notifications
            </button>
            <hr className="my-1" />
            <button className="w-full px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground rounded text-destructive">
              Sign Out
            </button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  ),
}

// More actions menu
export const MoreActionsMenu: Story = {
  render: args => (
    <Popover {...args}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon">
          <MoreVertical className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-48" align="end">
        <div className="space-y-1">
          <button className="w-full px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground rounded">
            Edit
          </button>
          <button className="w-full px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground rounded">
            Duplicate
          </button>
          <button className="w-full px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground rounded">
            Share
          </button>
          <hr className="my-1" />
          <button className="w-full px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground rounded text-destructive">
            Delete
          </button>
        </div>
      </PopoverContent>
    </Popover>
  ),
}

// Filter popover
export const FilterPopover: Story = {
  render: args => (
    <Popover {...args}>
      <PopoverTrigger asChild>
        <Button variant="outline">
          <Filter className="mr-2 h-4 w-4" />
          Filters
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80">
        <div className="space-y-4">
          <div className="space-y-2">
            <h4 className="font-medium">Filters</h4>
            <p className="text-sm text-muted-foreground">
              Customize your view with these filter options.
            </p>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label htmlFor="show-completed">Show completed</Label>
              <input type="checkbox" id="show-completed" />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="show-archived">Show archived</Label>
              <input type="checkbox" id="show-archived" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="priority">Priority</Label>
              <select id="priority" className="w-full p-2 border rounded">
                <option>All</option>
                <option>High</option>
                <option>Medium</option>
                <option>Low</option>
              </select>
            </div>
            <div className="flex justify-end space-x-2 pt-2">
              <Button variant="outline" size="sm">
                Reset
              </Button>
              <Button size="sm">Apply</Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  ),
}

// Different alignments
export const AlignStart: Story = {
  render: args => (
    <Popover {...args}>
      <PopoverTrigger asChild>
        <Button variant="outline">Align Start</Button>
      </PopoverTrigger>
      <PopoverContent align="start">
        <div className="space-y-2">
          <h4 className="font-medium">Aligned to Start</h4>
          <p className="text-sm text-muted-foreground">
            This popover is aligned to the start of the trigger.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  ),
}

export const AlignEnd: Story = {
  render: args => (
    <Popover {...args}>
      <PopoverTrigger asChild>
        <Button variant="outline">Align End</Button>
      </PopoverTrigger>
      <PopoverContent align="end">
        <div className="space-y-2">
          <h4 className="font-medium">Aligned to End</h4>
          <p className="text-sm text-muted-foreground">
            This popover is aligned to the end of the trigger.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  ),
}

// Different side offsets
export const WithSideOffset: Story = {
  render: args => (
    <Popover {...args}>
      <PopoverTrigger asChild>
        <Button variant="outline">With Side Offset</Button>
      </PopoverTrigger>
      <PopoverContent sideOffset={20}>
        <div className="space-y-2">
          <h4 className="font-medium">Increased Side Offset</h4>
          <p className="text-sm text-muted-foreground">
            This popover has a larger side offset from the trigger.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  ),
}

// Custom width
export const CustomWidth: Story = {
  render: args => (
    <Popover {...args}>
      <PopoverTrigger asChild>
        <Button variant="outline">Custom Width</Button>
      </PopoverTrigger>
      <PopoverContent className="w-96">
        <div className="space-y-2">
          <h4 className="font-medium">Custom Width Popover</h4>
          <p className="text-sm text-muted-foreground">
            This popover has a custom width that's wider than the default. It can accommodate more
            content or provide a more spacious layout.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  ),
}

// Small content
export const SmallContent: Story = {
  render: args => (
    <Popover {...args}>
      <PopoverTrigger asChild>
        <Button variant="outline">Small</Button>
      </PopoverTrigger>
      <PopoverContent className="w-fit">
        <p className="text-sm">Small content</p>
      </PopoverContent>
    </Popover>
  ),
}

// Multiple popovers demonstration
export const MultiplePopovers: Story = {
  render: () => (
    <div className="flex space-x-4">
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline">First</Button>
        </PopoverTrigger>
        <PopoverContent>
          <div className="space-y-2">
            <h4 className="font-medium">First Popover</h4>
            <p className="text-sm text-muted-foreground">This is the first popover.</p>
          </div>
        </PopoverContent>
      </Popover>

      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline">Second</Button>
        </PopoverTrigger>
        <PopoverContent>
          <div className="space-y-2">
            <h4 className="font-medium">Second Popover</h4>
            <p className="text-sm text-muted-foreground">This is the second popover.</p>
          </div>
        </PopoverContent>
      </Popover>

      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline">Third</Button>
        </PopoverTrigger>
        <PopoverContent>
          <div className="space-y-2">
            <h4 className="font-medium">Third Popover</h4>
            <p className="text-sm text-muted-foreground">This is the third popover.</p>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  ),
}
