// TODO: Enable when Storybook is properly configured and dependencies are installed
// import type { Meta, StoryObj } from '@storybook/react'
// import { fn } from '@storybook/test'
// import { SessionLauncher } from './SessionLauncher'

// Mock the hooks for Storybook - available when Storybook is configured
// const _mockUseSessionLauncher = () => ({
//   query: '',
//   setQuery: fn(),
//   config: {},
//   setConfig: fn(),
//   launchSession: fn(),
//   isLaunching: false,
//   error: null,
//   mode: 'command' as const,
//   view: 'menu' as const,
//   setView: fn(),
// })

// const _mockUseStealHotkeyScope = () => {}

// Add mock implementations for Storybook
// const withMocks = (Story: any) => {
// Mock the hooks - would be activated when Storybook is configured
// require('@/hooks/useSessionLauncher').useSessionLauncher = mockUseSessionLauncher
// require('@/hooks/useStealHotkeyScope').useStealHotkeyScope = mockUseStealHotkeyScope
// require('react-hotkeys-hook').useHotkeys = fn()

// return <Story />
// }

// Storybook configuration - disabled until dependencies are installed
/*
const meta = {
  title: 'Components/SessionLauncher',
  component: SessionLauncher,
  decorators: [withMocks],
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
} satisfies Meta<typeof SessionLauncher>

export default meta
type Story = StoryObj<typeof meta>

// Default story - modal closed
export const Closed: Story = {
  args: {
    isOpen: false,
  },
}

// Modal open with command palette menu
export const Open: Story = {
  args: {
    isOpen: true,
  },
}

// Modal open in input view
export const InputView: Story = {
  args: {
    isOpen: true,
  },
  decorators: [
    Story => {
      // const _mockHook = () => ({
      //         query: 'Create a new React component',
      //         setQuery: fn(),
      //         config: {
      //           model: 'claude-3-sonnet-20240229',
      //           temperature: 0.7,
      //         },
      //         setConfig: fn(),
      //         launchSession: fn(),
      //         isLaunching: false,
      //         error: null,
      //         mode: 'command' as const,
      //         view: 'input' as const,
      //         setView: fn(),
      //       })

      // require('@/hooks/useSessionLauncher').useSessionLauncher = mockHook
      return <Story />
    },
  ],
}

// Modal with loading state
export const Loading: Story = {
  args: {
    isOpen: true,
  },
  decorators: [
    Story => {
      // const _mockHook = () => ({
      //         query: 'Create a new React component',
      //         setQuery: fn(),
      //         config: {},
      //         setConfig: fn(),
      //         launchSession: fn(),
      //         isLaunching: true,
      //         error: null,
      //         mode: 'command' as const,
      //         view: 'input' as const,
      //         setView: fn(),
      //       })

      // require('@/hooks/useSessionLauncher').useSessionLauncher = mockHook
      return <Story />
    },
  ],
}

// Modal with error state
export const WithError: Story = {
  args: {
    isOpen: true,
  },
  decorators: [
    Story => {
      // const _mockHook = () => ({
      //         query: 'Create a new React component',
      //         setQuery: fn(),
      //         config: {},
      //         setConfig: fn(),
      //         launchSession: fn(),
      //         isLaunching: false,
      //         error: 'Failed to launch session. Please check your connection and try again.',
      //         mode: 'command' as const,
      //         view: 'input' as const,
      //         setView: fn(),
      //       })

      // require('@/hooks/useSessionLauncher').useSessionLauncher = mockHook
      return <Story />
    },
  ],
}

// Session mode variant
export const SessionMode: Story = {
  args: {
    isOpen: true,
  },
  decorators: [
    Story => {
      // const _mockHook = () => ({
      //         query: '',
      //         setQuery: fn(),
      //         config: {},
      //         setConfig: fn(),
      //         launchSession: fn(),
      //         isLaunching: false,
      //         error: null,
      //         mode: 'session' as const,
      //         view: 'menu' as const,
      //         setView: fn(),
      //       })

      // require('@/hooks/useSessionLauncher').useSessionLauncher = mockHook
      return <Story />
    },
  ],
}
*/

// Export a placeholder to prevent module errors
export default {}
