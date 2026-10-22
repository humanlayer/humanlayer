import type { Meta, StoryObj } from '@storybook/react'
import { useReducer } from 'react'

import {
  HotkeyPlaygroundFrame,
  initialPlaygroundState,
  PlaygroundControls,
  playgroundActionForKeyEvent,
  playgroundReducer,
} from './hotkey-playground'

/**
 * Provider-free demo wrapper: local reducer state plus a keydown listener that
 * maps through the production key mapping. In the app the same reducer is
 * driven by useAppHotkeys under the HOTKEY_HELP scope.
 */
const HotkeyPlaygroundShellDemo = () => {
  const [state, dispatch] = useReducer(playgroundReducer, initialPlaygroundState)
  return (
    <div
      tabIndex={0}
      className="max-w-4xl space-y-2 outline-none"
      onKeyDown={(event) => {
        const action = playgroundActionForKeyEvent(event)
        if (!action) return
        event.preventDefault()
        dispatch(action)
      }}
    >
      <div className="px-2">
        <span className="text-[11px] font-medium text-muted-foreground">
          Click the frame, then follow the tutorial strip
        </span>
      </div>
      <PlaygroundControls state={state} />
      <HotkeyPlaygroundFrame state={state} />
    </div>
  )
}

const meta = {
  title: 'Shell Demos/HotkeyPlayground',
  component: HotkeyPlaygroundShellDemo,
} satisfies Meta<typeof HotkeyPlaygroundShellDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => <HotkeyPlaygroundShellDemo />,
}
