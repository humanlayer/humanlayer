import { describe, test, expect, beforeEach } from 'bun:test'
import { StoreApi } from 'zustand'
import {
  createComposedDemoStore,
  ComposedDemoStore,
  ComposedDemoAnimator,
  DemoAnimationStep,
} from './composedDemoStore'
import { createMockSessions } from '@/test-utils'

describe('ComposedDemoStore', () => {
  let store: StoreApi<ComposedDemoStore>

  beforeEach(() => {
    store = createComposedDemoStore()
  })

  describe('Store Composition', () => {
    test('should have all slice properties', () => {
      const state = store.getState()

      // SessionSlice properties
      expect(state.sessions).not.toBeUndefined()
      expect(state.focusedSession).not.toBeUndefined()
      expect(state.searchQuery).not.toBeUndefined()

      // LauncherSlice properties
      expect(state.isOpen).not.toBeUndefined()
      expect(state.mode).not.toBeUndefined()
      expect(state.view).not.toBeUndefined()
      expect(state.query).not.toBeUndefined()

      // ThemeSlice properties
      expect(state.theme).not.toBeUndefined()

      // AppSlice properties
      expect(state.connected).not.toBeUndefined()
      expect(state.status).not.toBeUndefined()
      expect(state.approvals).not.toBeUndefined()
      expect(state.currentRoute).not.toBeUndefined()
    })

    test('should have all slice actions', () => {
      const state = store.getState()

      // SessionSlice actions
      expect(typeof state.setSessions).toBe('function')
      expect(typeof state.setFocusedSession).toBe('function')
      expect(typeof state.addSession).toBe('function')
      expect(typeof state.focusNextSession).toBe('function')

      // LauncherSlice actions
      expect(typeof state.setOpen).toBe('function')
      expect(typeof state.openLauncher).toBe('function')
      expect(typeof state.closeLauncher).toBe('function')

      // ThemeSlice actions
      expect(typeof state.setTheme).toBe('function')
      expect(typeof state.cycleTheme).toBe('function')

      // AppSlice actions
      expect(typeof state.setConnected).toBe('function')
      expect(typeof state.setApprovals).toBe('function')
      expect(typeof state.navigateTo).toBe('function')
    })
  })

  describe('Cross-Slice Interactions', () => {
    test('slices should work independently', () => {
      const mockSessions = createMockSessions(3)

      // Modify SessionSlice
      store.getState().setSessions(mockSessions)
      expect(store.getState().sessions).toHaveLength(3)

      // Modify LauncherSlice
      store.getState().openLauncher('search')
      expect(store.getState().isOpen).toBe(true)
      expect(store.getState().mode).toBe('search')

      // Modify ThemeSlice
      store.getState().setTheme('catppuccin')
      expect(store.getState().theme).toBe('catppuccin')

      // Modify AppSlice
      store.getState().setConnected(false)
      expect(store.getState().connected).toBe(false)

      // Verify all changes persisted
      const finalState = store.getState()
      expect(finalState.sessions).toHaveLength(3)
      expect(finalState.isOpen).toBe(true)
      expect(finalState.theme).toBe('catppuccin')
      expect(finalState.connected).toBe(false)
    })
  })
})

describe('ComposedDemoAnimator', () => {
  let store: StoreApi<ComposedDemoStore>
  let animator: ComposedDemoAnimator

  beforeEach(() => {
    store = createComposedDemoStore()
  })

  test('should apply animation steps', async () => {
    const mockSessions = createMockSessions(2)
    const sequence: DemoAnimationStep[] = [
      {
        sessionState: { sessions: [] },
        delay: 10,
        description: 'Start empty',
      },
      {
        sessionState: { sessions: [mockSessions[0]] },
        launcherState: { isOpen: true },
        delay: 10,
        description: 'Add session and open launcher',
      },
      {
        themeState: { theme: 'framer-dark' },
        appState: { currentRoute: '/sessions' },
        delay: 10,
        description: 'Change theme and route',
      },
    ]

    animator = new ComposedDemoAnimator(store, sequence)

    // Check initial state
    expect(animator.getCurrentStep()).toBe(0)
    expect(animator.getTotalSteps()).toBe(3)
    expect(animator.getProgress()).toBe(0)

    // Start animation
    animator.start()

    // Wait for first step
    await new Promise(resolve => setTimeout(resolve, 15))
    expect(store.getState().sessions).toHaveLength(0)

    // Wait for second step
    await new Promise(resolve => setTimeout(resolve, 15))
    expect(store.getState().sessions).toHaveLength(1)
    expect(store.getState().isOpen).toBe(true)

    // Wait for third step
    await new Promise(resolve => setTimeout(resolve, 15))
    expect(store.getState().theme).toBe('framer-dark')
    expect(store.getState().currentRoute).toBe('/sessions')

    // Stop animator
    animator.stop()
  })

  test('should handle pause and resume', async () => {
    const sequence: DemoAnimationStep[] = [
      {
        sessionState: { searchQuery: 'step1' },
        delay: 20,
        description: 'Step 1',
      },
      {
        sessionState: { searchQuery: 'step2' },
        delay: 20,
        description: 'Step 2',
      },
      {
        sessionState: { searchQuery: 'step3' },
        delay: 20,
        description: 'Step 3',
      },
    ]

    animator = new ComposedDemoAnimator(store, sequence)
    animator.start()

    // Wait for first step
    await new Promise(resolve => setTimeout(resolve, 25))
    expect(store.getState().searchQuery).toBe('step1')

    // Pause
    animator.pause()
    const stepAtPause = animator.getCurrentStep()

    // Wait (nothing should change)
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(store.getState().searchQuery).toBe('step1')
    expect(animator.getCurrentStep()).toBe(stepAtPause)

    // Resume
    animator.resume()

    // Should continue with next steps
    await new Promise(resolve => setTimeout(resolve, 25))
    expect(store.getState().searchQuery).toBe('step2')

    animator.stop()
  })

  test('should loop sequence', async () => {
    const sequence: DemoAnimationStep[] = [
      {
        appState: { status: 'start' },
        delay: 10,
        description: 'Start',
      },
      {
        appState: { status: 'end' },
        delay: 10,
        description: 'End',
      },
    ]

    animator = new ComposedDemoAnimator(store, sequence)
    animator.start()

    // Complete first loop
    await new Promise(resolve => setTimeout(resolve, 25))
    expect(store.getState().status).toBe('end')

    // Should loop back to start
    await new Promise(resolve => setTimeout(resolve, 15))
    expect(store.getState().status).toBe('start')

    animator.stop()
  })

  test('should reset animator', () => {
    const sequence: DemoAnimationStep[] = [{ sessionState: { searchQuery: 'test' }, delay: 10 }]

    animator = new ComposedDemoAnimator(store, sequence)
    animator.start()

    // Move forward
    expect(animator.getCurrentStep()).toBe(0)

    // Reset
    animator.reset()
    expect(animator.getCurrentStep()).toBe(0)
  })
})
