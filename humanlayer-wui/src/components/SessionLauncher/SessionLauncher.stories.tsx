import type { Meta, StoryObj } from '@storybook/react'
import { fn } from '@storybook/test'
import { SessionLauncher } from './SessionLauncher'

// Mock the hooks for Storybook
const withMockedHooks = (mockState: any) => (Story: any) => {
  // Mock the hooks by temporarily replacing them in the global context
  const originalModules: any = {}

  // Set up mocks before rendering
  if (typeof window !== 'undefined') {
    // Save originals
    if ((globalThis as any).__storybookMocks) {
      originalModules.useSessionLauncher = (globalThis as any).__storybookMocks.useSessionLauncher
      originalModules.useStealHotkeyScope = (globalThis as any).__storybookMocks.useStealHotkeyScope
    }

    // Set up our mocks
    ;(globalThis as any).__storybookMocks = {
      useSessionLauncher: () => ({
        query: '',
        setQuery: fn(),
        config: {},
        setConfig: fn(),
        launchSession: fn(),
        isLaunching: false,
        error: null,
        mode: 'command' as const,
        view: 'menu' as const,
        setView: fn(),
        ...mockState,
      }),
      useStealHotkeyScope: () => {},
    }
  }

  return <Story />
}

const meta: Meta<typeof SessionLauncher> = {
  title: 'Components/SessionLauncher',
  component: SessionLauncher,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'A modal component for launching new Claude Code sessions with command palette functionality.',
      },
    },
  },
  args: {
    onClose: fn(),
  },
  argTypes: {
    isOpen: {
      control: 'boolean',
      description: 'Controls whether the modal is visible',
    },
    onClose: {
      action: 'closed',
      description: 'Callback fired when the modal should close',
    },
  },
}

export default meta
type Story = StoryObj<typeof SessionLauncher>

// Default story - modal closed
export const Closed: Story = {
  args: {
    isOpen: false,
  },
  decorators: [withMockedHooks({})],
}

// Modal open with command palette menu
export const Open: Story = {
  args: {
    isOpen: true,
  },
  decorators: [withMockedHooks({ mode: 'command', view: 'menu' })],
}

// Modal open in input view
export const InputView: Story = {
  args: {
    isOpen: true,
  },
  decorators: [
    withMockedHooks({
      query: 'Create a new React component',
      config: {
        model: 'claude-3-sonnet-20240229',
        temperature: 0.7,
      },
      mode: 'command',
      view: 'input',
    }),
  ],
}

// Modal with loading state
export const Loading: Story = {
  args: {
    isOpen: true,
  },
  decorators: [
    withMockedHooks({
      query: 'Create a new React component',
      config: {},
      isLaunching: true,
      mode: 'command',
      view: 'input',
    }),
  ],
}

// Modal with error state
export const WithError: Story = {
  args: {
    isOpen: true,
  },
  decorators: [
    withMockedHooks({
      query: 'Create a new React component',
      config: {},
      isLaunching: false,
      error: 'Failed to launch session. Please check your connection and try again.',
      mode: 'command',
      view: 'input',
    }),
  ],
}

// Session mode variant
export const SessionMode: Story = {
  args: {
    isOpen: true,
  },
  decorators: [
    withMockedHooks({
      mode: 'session',
      view: 'menu',
    }),
  ],
}

// Complex configuration example
export const WithComplexConfig: Story = {
  args: {
    isOpen: true,
  },
  decorators: [
    withMockedHooks({
      query: 'Help me optimize this React application for performance',
      config: {
        model: 'claude-3-opus-20240229',
        temperature: 0.3,
        maxTokens: 4000,
        workingDirectory: '/Users/developer/projects/react-app',
        dangerouslySkipPermissions: false,
        autoAcceptEdits: true,
      },
      mode: 'command',
      view: 'input',
    }),
  ],
}
