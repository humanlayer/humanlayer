import type { Meta, StoryObj } from '@storybook/react'
import { KeyboardShortcut } from './keyboard-shortcut'
import { Button } from './button'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from './tooltip'

const meta: Meta<typeof KeyboardShortcut> = {
  title: 'UI/KeyboardShortcut',
  component: KeyboardShortcut,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  argTypes: {
    size: {
      control: 'select',
      options: ['sm', 'md'],
    },
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

// Basic shortcuts
export const Default: Story = {
  args: {
    children: '⌘K',
  },
}

export const SingleKey: Story = {
  args: {
    children: 'K',
  },
}

export const ModifierKey: Story = {
  args: {
    children: '⌘',
  },
}

// Size variants
export const Small: Story = {
  args: {
    size: 'sm',
    children: '⌘K',
  },
}

export const Medium: Story = {
  args: {
    size: 'md',
    children: '⌘K',
  },
}

// Common shortcuts
export const Copy: Story = {
  args: {
    children: '⌘C',
  },
}

export const Paste: Story = {
  args: {
    children: '⌘V',
  },
}

export const Save: Story = {
  args: {
    children: '⌘S',
  },
}

export const Undo: Story = {
  args: {
    children: '⌘Z',
  },
}

export const Redo: Story = {
  args: {
    children: '⌘Y',
  },
}

// Multi-key shortcuts
export const MultiKey: Story = {
  render: () => (
    <div className="flex items-center gap-1">
      <KeyboardShortcut>⌘</KeyboardShortcut>
      <KeyboardShortcut>⇧</KeyboardShortcut>
      <KeyboardShortcut>P</KeyboardShortcut>
    </div>
  ),
}

export const CtrlShiftN: Story = {
  render: () => (
    <div className="flex items-center gap-1">
      <KeyboardShortcut>Ctrl</KeyboardShortcut>
      <span className="text-muted-foreground">+</span>
      <KeyboardShortcut>⇧</KeyboardShortcut>
      <span className="text-muted-foreground">+</span>
      <KeyboardShortcut>N</KeyboardShortcut>
    </div>
  ),
}

// Function keys
export const FunctionKeys: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <KeyboardShortcut>F1</KeyboardShortcut>
      <KeyboardShortcut>F5</KeyboardShortcut>
      <KeyboardShortcut>F11</KeyboardShortcut>
      <KeyboardShortcut>F12</KeyboardShortcut>
    </div>
  ),
}

// Arrow keys
export const ArrowKeys: Story = {
  render: () => (
    <div className="grid grid-cols-3 gap-1 w-32">
      <div></div>
      <KeyboardShortcut>↑</KeyboardShortcut>
      <div></div>
      <KeyboardShortcut>←</KeyboardShortcut>
      <KeyboardShortcut>↓</KeyboardShortcut>
      <KeyboardShortcut>→</KeyboardShortcut>
    </div>
  ),
}

// Numbers
export const Numbers: Story = {
  render: () => (
    <div className="flex items-center gap-1">
      {Array.from({ length: 10 }, (_, i) => (
        <KeyboardShortcut key={i}>{i}</KeyboardShortcut>
      ))}
    </div>
  ),
}

// Special keys
export const SpecialKeys: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <KeyboardShortcut>Space</KeyboardShortcut>
      <KeyboardShortcut>Tab</KeyboardShortcut>
      <KeyboardShortcut>Enter</KeyboardShortcut>
      <KeyboardShortcut>Esc</KeyboardShortcut>
      <KeyboardShortcut>Del</KeyboardShortcut>
      <KeyboardShortcut>⌫</KeyboardShortcut>
    </div>
  ),
}

// With buttons
export const WithButtons: Story = {
  render: () => (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="outline">New File</Button>
        <KeyboardShortcut>⌘N</KeyboardShortcut>
      </div>

      <div className="flex items-center gap-2">
        <Button variant="outline">Save</Button>
        <KeyboardShortcut>⌘S</KeyboardShortcut>
      </div>

      <div className="flex items-center gap-2">
        <Button variant="outline">Copy</Button>
        <KeyboardShortcut>⌘C</KeyboardShortcut>
      </div>
    </div>
  ),
}

// In tooltips
export const InTooltips: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline">Save</Button>
        </TooltipTrigger>
        <TooltipContent>
          <div className="flex items-center gap-2">
            <span>Save file</span>
            <KeyboardShortcut>⌘S</KeyboardShortcut>
          </div>
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline">Open</Button>
        </TooltipTrigger>
        <TooltipContent>
          <div className="flex items-center gap-2">
            <span>Open file</span>
            <KeyboardShortcut>⌘O</KeyboardShortcut>
          </div>
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline">Search</Button>
        </TooltipTrigger>
        <TooltipContent>
          <div className="flex items-center gap-2">
            <span>Search</span>
            <KeyboardShortcut>⌘F</KeyboardShortcut>
          </div>
        </TooltipContent>
      </Tooltip>
    </div>
  ),
}

// Menu style
export const MenuStyle: Story = {
  render: () => (
    <div className="w-64 border rounded-md bg-card p-1">
      <div className="flex items-center justify-between px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground rounded cursor-pointer">
        <span>New File</span>
        <KeyboardShortcut>⌘N</KeyboardShortcut>
      </div>
      <div className="flex items-center justify-between px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground rounded cursor-pointer">
        <span>Open</span>
        <KeyboardShortcut>⌘O</KeyboardShortcut>
      </div>
      <div className="flex items-center justify-between px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground rounded cursor-pointer">
        <span>Save</span>
        <KeyboardShortcut>⌘S</KeyboardShortcut>
      </div>
      <hr className="my-1" />
      <div className="flex items-center justify-between px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground rounded cursor-pointer">
        <span>Copy</span>
        <KeyboardShortcut>⌘C</KeyboardShortcut>
      </div>
      <div className="flex items-center justify-between px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground rounded cursor-pointer">
        <span>Paste</span>
        <KeyboardShortcut>⌘V</KeyboardShortcut>
      </div>
    </div>
  ),
}

// Platform specific
export const PlatformSpecific: Story = {
  render: () => (
    <div className="space-y-4">
      <div>
        <h4 className="text-sm font-medium mb-2">macOS</h4>
        <div className="flex items-center gap-2">
          <KeyboardShortcut>⌘</KeyboardShortcut>
          <KeyboardShortcut>⌥</KeyboardShortcut>
          <KeyboardShortcut>⇧</KeyboardShortcut>
          <KeyboardShortcut>⌃</KeyboardShortcut>
        </div>
      </div>

      <div>
        <h4 className="text-sm font-medium mb-2">Windows/Linux</h4>
        <div className="flex items-center gap-2">
          <KeyboardShortcut>Ctrl</KeyboardShortcut>
          <KeyboardShortcut>Alt</KeyboardShortcut>
          <KeyboardShortcut>Shift</KeyboardShortcut>
          <KeyboardShortcut>Win</KeyboardShortcut>
        </div>
      </div>
    </div>
  ),
}

// All sizes comparison
export const SizeComparison: Story = {
  render: () => (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-sm w-12">Small:</span>
        <KeyboardShortcut size="sm">⌘K</KeyboardShortcut>
        <KeyboardShortcut size="sm">A</KeyboardShortcut>
        <KeyboardShortcut size="sm">F1</KeyboardShortcut>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-sm w-12">Medium:</span>
        <KeyboardShortcut size="md">⌘K</KeyboardShortcut>
        <KeyboardShortcut size="md">A</KeyboardShortcut>
        <KeyboardShortcut size="md">F1</KeyboardShortcut>
      </div>
    </div>
  ),
}

// Common combinations
export const CommonCombinations: Story = {
  render: () => (
    <div className="grid grid-cols-2 gap-4 w-80">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm">New</span>
          <KeyboardShortcut>⌘N</KeyboardShortcut>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm">Open</span>
          <KeyboardShortcut>⌘O</KeyboardShortcut>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm">Save</span>
          <KeyboardShortcut>⌘S</KeyboardShortcut>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm">Print</span>
          <KeyboardShortcut>⌘P</KeyboardShortcut>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm">Copy</span>
          <KeyboardShortcut>⌘C</KeyboardShortcut>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm">Cut</span>
          <KeyboardShortcut>⌘X</KeyboardShortcut>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm">Paste</span>
          <KeyboardShortcut>⌘V</KeyboardShortcut>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm">Select All</span>
          <KeyboardShortcut>⌘A</KeyboardShortcut>
        </div>
      </div>
    </div>
  ),
}

// Custom styling
export const CustomStyling: Story = {
  render: () => (
    <div className="space-y-2">
      <KeyboardShortcut className="bg-blue-100 text-blue-800 border-blue-300">Custom</KeyboardShortcut>
      <KeyboardShortcut className="bg-green-100 text-green-800 border-green-300">
        Colors
      </KeyboardShortcut>
      <KeyboardShortcut className="bg-red-100 text-red-800 border-red-300">Style</KeyboardShortcut>
    </div>
  ),
}
