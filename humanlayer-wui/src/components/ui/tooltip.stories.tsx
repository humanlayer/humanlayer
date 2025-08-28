import type { Meta, StoryObj } from '@storybook/react'
import { fn } from '@storybook/test'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from './tooltip'
import { Button } from './button'
import { Input } from './input'
import { HelpCircle, Info, AlertTriangle, Settings, Plus, Calendar, User } from 'lucide-react'

const meta: Meta<typeof Tooltip> = {
  title: 'UI/Tooltip',
  component: Tooltip,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  argTypes: {
    open: {
      control: 'boolean',
    },
    delayDuration: {
      control: 'number',
    },
  },
  args: {
    onOpenChange: fn(),
  },
  decorators: [
    Story => (
      <TooltipProvider>
        <Story />
      </TooltipProvider>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof meta>

// Basic tooltip
export const Default: Story = {
  render: args => (
    <Tooltip {...args}>
      <TooltipTrigger asChild>
        <Button variant="outline">Hover me</Button>
      </TooltipTrigger>
      <TooltipContent>
        <p>This is a tooltip</p>
      </TooltipContent>
    </Tooltip>
  ),
}

// Tooltip on button with icon
export const OnIconButton: Story = {
  render: args => (
    <Tooltip {...args}>
      <TooltipTrigger asChild>
        <Button variant="outline" size="icon">
          <HelpCircle className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p>Get help</p>
      </TooltipContent>
    </Tooltip>
  ),
}

// Tooltip on text
export const OnText: Story = {
  render: args => (
    <div className="text-center">
      <Tooltip {...args}>
        <TooltipTrigger asChild>
          <span className="underline decoration-dotted cursor-help">Hover over this text</span>
        </TooltipTrigger>
        <TooltipContent>
          <p>Additional information about this text</p>
        </TooltipContent>
      </Tooltip>
    </div>
  ),
}

// Tooltip with longer content
export const LongContent: Story = {
  render: args => (
    <Tooltip {...args}>
      <TooltipTrigger asChild>
        <Button variant="outline">
          <Info className="mr-2 h-4 w-4" />
          Information
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <div className="max-w-xs">
          <p>
            This is a longer tooltip content that demonstrates how the component handles multiple lines
            of text and provides more detailed information.
          </p>
        </div>
      </TooltipContent>
    </Tooltip>
  ),
}

// Different side positions
export const TopSide: Story = {
  render: args => (
    <Tooltip {...args}>
      <TooltipTrigger asChild>
        <Button variant="outline">Top</Button>
      </TooltipTrigger>
      <TooltipContent side="top">
        <p>Tooltip on top</p>
      </TooltipContent>
    </Tooltip>
  ),
}

export const RightSide: Story = {
  render: args => (
    <Tooltip {...args}>
      <TooltipTrigger asChild>
        <Button variant="outline">Right</Button>
      </TooltipTrigger>
      <TooltipContent side="right">
        <p>Tooltip on right</p>
      </TooltipContent>
    </Tooltip>
  ),
}

export const BottomSide: Story = {
  render: args => (
    <Tooltip {...args}>
      <TooltipTrigger asChild>
        <Button variant="outline">Bottom</Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <p>Tooltip on bottom</p>
      </TooltipContent>
    </Tooltip>
  ),
}

export const LeftSide: Story = {
  render: args => (
    <Tooltip {...args}>
      <TooltipTrigger asChild>
        <Button variant="outline">Left</Button>
      </TooltipTrigger>
      <TooltipContent side="left">
        <p>Tooltip on left</p>
      </TooltipContent>
    </Tooltip>
  ),
}

// Different alignments
export const AlignStart: Story = {
  render: args => (
    <Tooltip {...args}>
      <TooltipTrigger asChild>
        <Button variant="outline">Align Start</Button>
      </TooltipTrigger>
      <TooltipContent align="start">
        <p>Aligned to start</p>
      </TooltipContent>
    </Tooltip>
  ),
}

export const AlignEnd: Story = {
  render: args => (
    <Tooltip {...args}>
      <TooltipTrigger asChild>
        <Button variant="outline">Align End</Button>
      </TooltipTrigger>
      <TooltipContent align="end">
        <p>Aligned to end</p>
      </TooltipContent>
    </Tooltip>
  ),
}

// With side offset
export const WithSideOffset: Story = {
  render: args => (
    <Tooltip {...args}>
      <TooltipTrigger asChild>
        <Button variant="outline">Side Offset</Button>
      </TooltipTrigger>
      <TooltipContent sideOffset={15}>
        <p>Tooltip with increased side offset</p>
      </TooltipContent>
    </Tooltip>
  ),
}

// Warning tooltip
export const WarningTooltip: Story = {
  render: args => (
    <Tooltip {...args}>
      <TooltipTrigger asChild>
        <Button variant="destructive">
          <AlertTriangle className="mr-2 h-4 w-4" />
          Dangerous Action
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p>⚠️ This action cannot be undone</p>
      </TooltipContent>
    </Tooltip>
  ),
}

// Tooltip on disabled button
export const OnDisabledButton: Story = {
  render: args => (
    <Tooltip {...args}>
      <TooltipTrigger asChild>
        {/* Need to wrap disabled button to make tooltip work */}
        <span tabIndex={0}>
          <Button disabled className="pointer-events-none">
            Disabled Button
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <p>This button is disabled</p>
      </TooltipContent>
    </Tooltip>
  ),
}

// Tooltip on form input
export const OnFormInput: Story = {
  render: args => (
    <div className="space-y-2">
      <label htmlFor="tooltip-input" className="text-sm font-medium">
        Username
      </label>
      <Tooltip {...args}>
        <TooltipTrigger asChild>
          <Input id="tooltip-input" placeholder="Enter username" className="w-64" />
        </TooltipTrigger>
        <TooltipContent>
          <p>Username must be at least 3 characters long</p>
        </TooltipContent>
      </Tooltip>
    </div>
  ),
}

// Keyboard accessible tooltip
export const KeyboardAccessible: Story = {
  render: args => (
    <Tooltip {...args}>
      <TooltipTrigger asChild>
        <button className="p-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500">
          Focus me with Tab
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <p>This tooltip is keyboard accessible</p>
      </TooltipContent>
    </Tooltip>
  ),
}

// Multiple tooltips
export const MultipleTooltips: Story = {
  render: () => (
    <div className="flex space-x-4">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline" size="icon">
            <Plus className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>Add new item</p>
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline" size="icon">
            <Settings className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>Settings</p>
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline" size="icon">
            <Calendar className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>Open calendar</p>
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline" size="icon">
            <User className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>User profile</p>
        </TooltipContent>
      </Tooltip>
    </div>
  ),
}

// Tooltip with rich content
export const RichContent: Story = {
  render: args => (
    <Tooltip {...args}>
      <TooltipTrigger asChild>
        <Button variant="outline">Rich Tooltip</Button>
      </TooltipTrigger>
      <TooltipContent>
        <div className="text-center">
          <div className="font-semibold">Keyboard Shortcut</div>
          <div className="mt-1">
            <kbd className="px-1.5 py-0.5 text-xs bg-background border rounded">Ctrl + K</kbd>
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  ),
}

// All positions showcase
export const AllPositions: Story = {
  render: () => (
    <div className="grid grid-cols-3 gap-4 p-8">
      <div></div>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline">Top</Button>
        </TooltipTrigger>
        <TooltipContent side="top">
          <p>Top tooltip</p>
        </TooltipContent>
      </Tooltip>
      <div></div>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline">Left</Button>
        </TooltipTrigger>
        <TooltipContent side="left">
          <p>Left tooltip</p>
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline">Center</Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>Default position</p>
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline">Right</Button>
        </TooltipTrigger>
        <TooltipContent side="right">
          <p>Right tooltip</p>
        </TooltipContent>
      </Tooltip>

      <div></div>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline">Bottom</Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>Bottom tooltip</p>
        </TooltipContent>
      </Tooltip>
      <div></div>
    </div>
  ),
}

// Custom styling
export const CustomStyling: Story = {
  render: args => (
    <Tooltip {...args}>
      <TooltipTrigger asChild>
        <Button variant="outline">Custom Style</Button>
      </TooltipTrigger>
      <TooltipContent className="bg-purple-600 text-white border-purple-600">
        <p>Custom styled tooltip</p>
      </TooltipContent>
    </Tooltip>
  ),
}
