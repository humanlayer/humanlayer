import type { Meta, StoryObj } from '@storybook/react'
import { KeyboardShortcut } from './keyboard-shortcut'

const meta = {
  title: 'UI/KeyboardShortcut',
  component: KeyboardShortcut,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
} satisfies Meta<typeof KeyboardShortcut>

export default meta
type Story = StoryObj<typeof meta>

// Basic usage
export const Default: Story = {
  args: {
    children: '⌘+K',
  },
}

// Size variants
export const Sizes: Story = {
  render: () => (
    <div className="flex gap-4 items-center">
      <div className="flex flex-col items-center gap-2">
        <KeyboardShortcut size="sm">⌘+K</KeyboardShortcut>
        <span className="text-xs text-muted-foreground">sm (default)</span>
      </div>
      <div className="flex flex-col items-center gap-2">
        <KeyboardShortcut size="md">⌘+K</KeyboardShortcut>
        <span className="text-xs text-muted-foreground">md</span>
      </div>
    </div>
  ),
}

// Common shortcuts
export const CommonShortcuts: Story = {
  render: () => (
    <div className="flex flex-wrap gap-3">
      <KeyboardShortcut>⌘+K</KeyboardShortcut>
      <KeyboardShortcut>⌘+S</KeyboardShortcut>
      <KeyboardShortcut>⌘+⇧+P</KeyboardShortcut>
      <KeyboardShortcut>Alt+Y</KeyboardShortcut>
      <KeyboardShortcut>Enter</KeyboardShortcut>
      <KeyboardShortcut>Esc</KeyboardShortcut>
      <KeyboardShortcut>j/k</KeyboardShortcut>
    </div>
  ),
}

// Comparison: KeyboardShortcut vs raw kbd
export const ComparisonWithRawKbd: Story = {
  render: () => (
    <div className="flex flex-col gap-8 p-4">
      {/* KeyboardShortcut component */}
      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-foreground">
          KeyboardShortcut Component
        </h3>
        <p className="text-xs text-muted-foreground mb-2">
          Full styling: bg-muted, font-mono, fixed height, consistent design
        </p>
        <div className="flex flex-wrap gap-2">
          <KeyboardShortcut>j/k</KeyboardShortcut>
          <KeyboardShortcut>Shift+j/k</KeyboardShortcut>
          <KeyboardShortcut>⌘+A</KeyboardShortcut>
          <KeyboardShortcut>Enter</KeyboardShortcut>
          <KeyboardShortcut>Alt+Y</KeyboardShortcut>
        </div>
      </div>

      {/* Raw kbd element */}
      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-foreground">
          Raw &lt;kbd&gt; Element (minimal styling)
        </h3>
        <p className="text-xs text-muted-foreground mb-2">
          Lightweight: just border, rounded, padding - no background
        </p>
        <div className="flex flex-wrap gap-2 text-xs">
          <kbd className="px-1.5 py-0.5 border rounded">j/k</kbd>
          <kbd className="px-1.5 py-0.5 border rounded">Shift+j/k</kbd>
          <kbd className="px-1.5 py-0.5 border rounded">Cmd+a</kbd>
          <kbd className="px-1.5 py-0.5 border rounded">Enter</kbd>
          <kbd className="px-1.5 py-0.5 border rounded">Alt+y</kbd>
        </div>
      </div>

      {/* Side by side */}
      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-foreground">Side by Side</h3>
        <div className="flex gap-8">
          <div className="flex items-center gap-2">
            <KeyboardShortcut>⌘+K</KeyboardShortcut>
            <span className="text-xs text-muted-foreground">Component</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <kbd className="px-1.5 py-0.5 border rounded">Cmd+k</kbd>
            <span className="text-muted-foreground">Raw kbd</span>
          </div>
        </div>
      </div>
    </div>
  ),
}

// Hotkey hints bar pattern (like session table)
export const HotkeyHintsBar: Story = {
  render: () => (
    <div className="flex flex-col gap-6 w-full max-w-2xl">
      {/* Using KeyboardShortcut component */}
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">With KeyboardShortcut Component</h3>
        <div className="flex flex-wrap gap-2 p-2 text-xs border rounded-md bg-muted/30">
          <span className="flex items-center gap-1">
            <KeyboardShortcut>j/k</KeyboardShortcut> Navigate
          </span>
          <span className="flex items-center gap-1">
            <KeyboardShortcut>Shift+j/k</KeyboardShortcut> Select range
          </span>
          <span className="flex items-center gap-1">
            <KeyboardShortcut>x</KeyboardShortcut> Toggle select
          </span>
          <span className="flex items-center gap-1">
            <KeyboardShortcut>⌘+A</KeyboardShortcut> Select all
          </span>
          <span className="flex items-center gap-1">
            <KeyboardShortcut>Enter</KeyboardShortcut> Activate
          </span>
          <span className="flex items-center gap-1">
            <KeyboardShortcut>Alt+Y</KeyboardShortcut> Bypass perms
          </span>
        </div>
      </div>

      {/* Using raw kbd */}
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">With Raw &lt;kbd&gt;</h3>
        <div className="flex flex-wrap gap-2 p-2 text-xs border rounded-md">
          <span>
            <kbd className="px-1.5 py-0.5 border rounded">j/k</kbd> Navigate
          </span>
          <span>
            <kbd className="px-1.5 py-0.5 border rounded">Shift+j/k</kbd> Select
            range
          </span>
          <span>
            <kbd className="px-1.5 py-0.5 border rounded">x</kbd> Toggle select
          </span>
          <span>
            <kbd className="px-1.5 py-0.5 border rounded">Cmd+a</kbd> Select all
          </span>
          <span>
            <kbd className="px-1.5 py-0.5 border rounded">Enter</kbd> Activate
          </span>
          <span>
            <kbd className="px-1.5 py-0.5 border rounded">Alt+y</kbd> Bypass
            perms
          </span>
        </div>
      </div>
    </div>
  ),
}

// In tooltip context
export const InTooltipContext: Story = {
  render: () => (
    <div className="flex flex-col gap-4 p-4 bg-popover border rounded-md shadow-md">
      <div className="text-sm">
        <p className="flex items-center gap-1">
          Enable bypass permissions <KeyboardShortcut>Alt+Y</KeyboardShortcut>
        </p>
      </div>
      <div className="text-sm">
        <p className="flex items-center gap-1">
          Open command palette <KeyboardShortcut>⌘+K</KeyboardShortcut>
        </p>
      </div>
      <div className="text-sm">
        <p className="flex items-center gap-1">
          Submit message <KeyboardShortcut>⌘+Enter</KeyboardShortcut>
        </p>
      </div>
    </div>
  ),
}

// In button context
export const InButtonContext: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <h3 className="text-sm font-semibold">Shortcuts inside buttons</h3>
      <div className="flex gap-2">
        <button className="inline-flex items-center gap-2 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-md">
          Send
          <KeyboardShortcut className="bg-primary-foreground/20 text-primary-foreground border-primary-foreground/30">
            ⌘+Enter
          </KeyboardShortcut>
        </button>
        <button className="inline-flex items-center gap-2 px-3 py-1.5 text-sm bg-secondary text-secondary-foreground rounded-md">
          Cancel
          <KeyboardShortcut>Esc</KeyboardShortcut>
        </button>
      </div>
    </div>
  ),
}
