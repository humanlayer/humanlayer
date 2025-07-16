import { describe, test, expect, beforeEach } from 'bun:test'
import {
  createComposedDemoStore,
  ComposedDemoStore,
  ComposedDemoAnimator,
  DemoAnimationStep,
} from './composedDemoStore'
import { createMockSessions } from '@/test-utils'
import { createStoreTest, assertFunctions, testAnimationSteps } from './test-utils'

describe('ComposedDemoStore', () => {
  let store: ReturnType<typeof createStoreTest<ComposedDemoStore>>

  beforeEach(() => {
    store = createStoreTest(createComposedDemoStore)
  })

  describe('Store Composition', () => {
    test('should have all slice properties', () => {
      const state = store.getState()

      // Verify all properties exist
      const requiredProps = [
        // SessionSlice
        'sessions',
        'focusedSession',
        'searchQuery',
        // LauncherSlice
        'isOpen',
        'mode',
        'view',
        'query',
        // ThemeSlice
        'theme',
        // AppSlice
        'connected',
        'status',
        'approvals',
        'currentRoute',
      ]

      requiredProps.forEach(prop => {
        expect(prop in state).toBe(true)
      })
    })

    test('should have all slice actions', () => {
      assertFunctions(store.getState(), [
        // SessionSlice
        'setSessions',
        'setFocusedSession',
        'addSession',
        'focusNextSession',
        // LauncherSlice
        'setOpen',
        'openLauncher',
        'closeLauncher',
        // ThemeSlice
        'setTheme',
        'cycleTheme',
        // AppSlice
        'setConnected',
        'setApprovals',
        'navigateTo',
      ])
    })
  })

  describe('Cross-Slice Interactions', () => {
    test('slices should work independently', () => {
      const mockSessions = createMockSessions(3)

      // Modify all slices
      store.act(s => {
        s.setSessions(mockSessions)
        s.openLauncher('search')
        s.setTheme('catppuccin')
        s.setConnected(false)
      })

      // Verify all changes persisted
      const state = store.getState()
      expect(state.sessions).toHaveLength(3)
      expect(state.isOpen).toBe(true)
      expect(state.mode).toBe('search')
      expect(state.theme).toBe('catppuccin')
      expect(state.connected).toBe(false)
    })
  })
})

describe('ComposedDemoAnimator', () => {
  let store: ReturnType<typeof createStoreTest<ComposedDemoStore>>
  let animator: ComposedDemoAnimator

  beforeEach(() => {
    store = createStoreTest(createComposedDemoStore)
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

    animator = new ComposedDemoAnimator(store.store, sequence)

    // Verify initial state
    expect(animator.getCurrentStep()).toBe(0)
    expect(animator.getTotalSteps()).toBe(3)
    expect(animator.getProgress()).toBe(0)

    animator.start()

    // Test each step
    await testAnimationSteps([
      {
        wait: 15,
        test: () => expect(store.getState().sessions).toHaveLength(0),
        description: 'First step',
      },
      {
        wait: 15,
        test: () => {
          expect(store.getState().sessions).toHaveLength(1)
          expect(store.getState().isOpen).toBe(true)
        },
        description: 'Second step',
      },
      {
        wait: 15,
        test: () => {
          expect(store.getState().theme).toBe('framer-dark')
          expect(store.getState().currentRoute).toBe('/sessions')
        },
        description: 'Third step',
      },
    ])

    animator.stop()
  })

  test('should handle pause and resume', async () => {
    const sequence: DemoAnimationStep[] = [
      { sessionState: { searchQuery: 'step1' }, delay: 20 },
      { sessionState: { searchQuery: 'step2' }, delay: 20 },
      { sessionState: { searchQuery: 'step3' }, delay: 20 },
    ]

    animator = new ComposedDemoAnimator(store.store, sequence)
    animator.start()

    await testAnimationSteps([
      {
        wait: 25,
        test: () => expect(store.getState().searchQuery).toBe('step1'),
      },
      {
        wait: 0,
        test: () => {
          animator.pause()
          expect(animator.getCurrentStep()).toBeGreaterThan(0)
        },
      },
      {
        wait: 30,
        test: () => {
          // Should not change during pause
          expect(store.getState().searchQuery).toBe('step1')
          animator.resume()
        },
      },
      {
        wait: 25,
        test: () => expect(store.getState().searchQuery).toBe('step2'),
      },
    ])

    animator.stop()
  })

  test('should loop sequence', async () => {
    const sequence: DemoAnimationStep[] = [
      { appState: { status: 'start' }, delay: 10 },
      { appState: { status: 'end' }, delay: 10 },
    ]

    animator = new ComposedDemoAnimator(store.store, sequence)
    animator.start()

    // Complete first loop
    await testAnimationSteps([
      { wait: 25, test: () => expect(store.getState().status).toBe('end') },
      { wait: 15, test: () => expect(store.getState().status).toBe('start') },
    ])

    animator.stop()
  })

  test('should reset animator', () => {
    const sequence: DemoAnimationStep[] = [{ sessionState: { searchQuery: 'test' }, delay: 10 }]

    animator = new ComposedDemoAnimator(store.store, sequence)
    animator.start()

    expect(animator.getCurrentStep()).toBe(0)
    animator.reset()
    expect(animator.getCurrentStep()).toBe(0)
  })
})
