import { describe, expect, it } from 'vitest'

import {
  initialPlaygroundState,
  PLAYGROUND_STEPS,
  type PlaygroundAction,
  type PlaygroundState,
  playgroundActionForKeyEvent,
  playgroundConsumesEscape,
  playgroundReducer,
} from './hotkey-playground'

function run(state: PlaygroundState, actions: PlaygroundAction[]): PlaygroundState {
  return actions.reduce(playgroundReducer, state)
}

// One action per tutorial step, in order (the final step is terminal).
const TUTORIAL_SCRIPT: PlaygroundAction[] = [
  { type: 'down' }, // 1. j to scroll down
  { type: 'up' }, // 2. k to scroll up
  { type: 'enter' }, // 3. enter to focus the session input
  { type: 'escape' }, // 4. esc to clear the focus
  { type: 'down' }, // 5. j/k to scroll more
  { type: 'focusLeft' }, // 6. shift+h to focus the left nav
  { type: 'down' }, // 7. j/k to scroll the left nav
  { type: 'expand' }, // 8. l to expand an item
  { type: 'collapse' }, // 9. h to contract an item
  { type: 'focusRight' }, // 10. shift+l to defocus the left nav
  { type: 'focusRight' }, // 11. shift+l to focus the artifact viewer
  { type: 'down' }, // 12. j/k to scroll the artifact content
  { type: 'focusLeft' }, // 13. shift+h to focus the main content
  { type: 'toggleSidebar' }, // 14. s to hide the sidebar
  { type: 'toggleSidebar' }, // 15. s to bring the sidebar back
]

describe('playgroundReducer', () => {
  it('advances exactly one step per scripted action through the whole tutorial', () => {
    let state = initialPlaygroundState
    TUTORIAL_SCRIPT.forEach((action, index) => {
      state = playgroundReducer(state, action)
      expect(state.step).toBe(index + 1)
    })
    expect(state.step).toBe(PLAYGROUND_STEPS.length - 1)
    const finalStep = PLAYGROUND_STEPS[state.step]
    if (finalStep === undefined) throw new Error('expected a final playground step')
    expect(finalStep.advances).toBeUndefined()
  })

  it('keys work out of order without advancing the step', () => {
    // Jumping straight to the artifact viewer works (free play) but step stays 0.
    const state = run(initialPlaygroundState, [{ type: 'focusRight' }, { type: 'down' }])
    expect(state.area).toBe('PLAYGROUND_RIGHT_PANE')
    expect(state.artifactLine).toBe(1)
    expect(state.step).toBe(0)
  })

  it('swallows everything except escape while the input is focused', () => {
    const focused = run(initialPlaygroundState, [{ type: 'down' }, { type: 'up' }, { type: 'enter' }])
    expect(focused.inputFocused).toBe(true)
    const after = run(focused, [
      { type: 'down' },
      { type: 'focusLeft' },
      { type: 'toggleSidebar' },
      { type: 'restart' },
    ])
    expect(after).toEqual(focused)
    const cleared = playgroundReducer(after, { type: 'escape' })
    expect(cleared.inputFocused).toBe(false)
    expect(cleared.step).toBe(4)
  })

  it('skips the right pane when the sidebar is collapsed', () => {
    const collapsed = run(initialPlaygroundState, [{ type: 'toggleSidebar' }, { type: 'focusRight' }])
    expect(collapsed.sidebarCollapsed).toBe(true)
    expect(collapsed.area).toBe('PLAYGROUND_MAIN')
  })

  it('returns focus to main when collapsing the sidebar from the right pane', () => {
    const state = run(initialPlaygroundState, [{ type: 'focusRight' }, { type: 'toggleSidebar' }])
    expect(state.sidebarCollapsed).toBe(true)
    expect(state.area).toBe('PLAYGROUND_MAIN')
  })

  it('focuses the sidebar when opening it, and returns to main when closing it', () => {
    // Open from main → sidebar becomes the focused pane.
    const opened = run(initialPlaygroundState, [{ type: 'toggleSidebar' }, { type: 'toggleSidebar' }])
    expect(opened.sidebarCollapsed).toBe(false)
    expect(opened.area).toBe('PLAYGROUND_RIGHT_PANE')
    // Closing again from anywhere drops focus back to main.
    const closed = run(opened, [{ type: 'focusLeft' }, { type: 'toggleSidebar' }])
    expect(closed.sidebarCollapsed).toBe(true)
    expect(closed.area).toBe('PLAYGROUND_MAIN')
  })

  it('collapsing from a child row refocuses the parent row', () => {
    const state = run(initialPlaygroundState, [
      { type: 'focusLeft' },
      { type: 'down' }, // nav row 1
      { type: 'expand' },
      { type: 'down' }, // first child
      { type: 'collapse' },
    ])
    expect(state.expandedNavRow).toBeNull()
    expect(state.navIndex).toBe(1)
  })

  it('restart resets everything and counts for the blink; reset is pristine', () => {
    const mid = run(initialPlaygroundState, TUTORIAL_SCRIPT.slice(0, 8))
    expect(mid.step).toBe(8)
    const restarted = playgroundReducer(mid, { type: 'restart' })
    expect(restarted).toEqual({ ...initialPlaygroundState, restartCount: 1 })
    expect(playgroundReducer(restarted, { type: 'restart' }).restartCount).toBe(2)
    expect(playgroundReducer(restarted, { type: 'reset' })).toEqual(initialPlaygroundState)
  })

  it('reset applies even while the input is focused', () => {
    const focused = run(initialPlaygroundState, [{ type: 'enter' }])
    expect(focused.inputFocused).toBe(true)
    expect(playgroundReducer(focused, { type: 'reset' })).toEqual(initialPlaygroundState)
  })

  it('records the last action and bumps the sequence for the controls light-up', () => {
    const first = playgroundReducer(initialPlaygroundState, { type: 'down' })
    expect(first.lastAction).toBe('down')
    expect(first.actionSeq).toBe(1)
    // A repeat re-fires (seq bumps) even if the position clamps.
    const second = playgroundReducer(first, { type: 'up' })
    expect(second.lastAction).toBe('up')
    expect(second.actionSeq).toBe(2)
    // Swallowed keys (input focused) don't light a control or bump the seq.
    const focused = run(initialPlaygroundState, [{ type: 'enter' }])
    const swallowed = playgroundReducer(focused, { type: 'down' })
    expect(swallowed).toBe(focused)
  })
})

describe('playgroundConsumesEscape', () => {
  it('consumes only while the fake input is focused; a side pane still lets the dialog close', () => {
    expect(playgroundConsumesEscape(initialPlaygroundState)).toBe(false)
    expect(playgroundConsumesEscape({ ...initialPlaygroundState, inputFocused: true })).toBe(true)
    expect(playgroundConsumesEscape({ ...initialPlaygroundState, area: 'PLAYGROUND_LEFT_NAV' })).toBe(false)
    expect(playgroundConsumesEscape({ ...initialPlaygroundState, area: 'PLAYGROUND_RIGHT_PANE' })).toBe(false)
  })
})

describe('playgroundActionForKeyEvent', () => {
  it('maps the tutorial key set, including arrows and shifted variants', () => {
    expect(playgroundActionForKeyEvent({ key: 'j', shiftKey: false })).toEqual({ type: 'down' })
    expect(playgroundActionForKeyEvent({ key: 'ArrowDown', shiftKey: false })).toEqual({ type: 'down' })
    expect(playgroundActionForKeyEvent({ key: 'K', shiftKey: false })).toEqual({ type: 'up' })
    expect(playgroundActionForKeyEvent({ key: 'l', shiftKey: false })).toEqual({ type: 'expand' })
    expect(playgroundActionForKeyEvent({ key: 'ArrowLeft', shiftKey: false })).toEqual({ type: 'collapse' })
    expect(playgroundActionForKeyEvent({ key: 'H', shiftKey: true })).toEqual({ type: 'focusLeft' })
    expect(playgroundActionForKeyEvent({ key: 'ArrowRight', shiftKey: true })).toEqual({ type: 'focusRight' })
    expect(playgroundActionForKeyEvent({ key: 'Enter', shiftKey: false })).toEqual({ type: 'enter' })
    expect(playgroundActionForKeyEvent({ key: 'Escape', shiftKey: false })).toEqual({ type: 'escape' })
    expect(playgroundActionForKeyEvent({ key: 's', shiftKey: false })).toEqual({ type: 'toggleSidebar' })
    expect(playgroundActionForKeyEvent({ key: 'S', shiftKey: true })).toEqual({ type: 'toggleSidebar' })
    expect(playgroundActionForKeyEvent({ key: 'r', shiftKey: false })).toEqual({ type: 'restart' })
  })

  it('ignores modified keys and keys outside the set', () => {
    expect(playgroundActionForKeyEvent({ key: 'j', shiftKey: false, metaKey: true })).toBeNull()
    expect(playgroundActionForKeyEvent({ key: 'k', shiftKey: false, ctrlKey: true })).toBeNull()
    expect(playgroundActionForKeyEvent({ key: 'q', shiftKey: false })).toBeNull()
    expect(playgroundActionForKeyEvent({ key: 'j', shiftKey: true })).toBeNull()
  })
})
