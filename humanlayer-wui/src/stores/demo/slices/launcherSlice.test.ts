import { describe, test, expect, beforeEach } from 'bun:test'
import { create } from 'zustand'
import { createLauncherSlice, LauncherSlice } from './launcherSlice'
import { createStoreTest, testInitialState, createNavigationTests } from '../test-utils'

describe('Demo LauncherSlice', () => {
  let store: ReturnType<typeof createStoreTest<LauncherSlice>>

  beforeEach(() => {
    store = createStoreTest(() => create<LauncherSlice>()(createLauncherSlice))
  })

  describe('Initial State', () => {
    test('should initialize with correct defaults', () => {
      testInitialState(store.getState(), {
        isOpen: false,
        mode: 'command',
        view: 'menu',
        query: '',
        isLaunching: false,
        error: undefined,
        selectedMenuIndex: 0,
      })
    })
  })

  describe('Basic State Updates', () => {
    test('should handle all setters', () => {
      store.testSetters([
        ['setOpen', 'isOpen', true],
        ['setOpen', 'isOpen', false],
        ['setMode', 'mode', 'command'],
        ['setView', 'view', 'input'],
        ['setView', 'view', 'menu'],
        ['setQuery', 'query', 'test query'],
        ['setIsLaunching', 'isLaunching', true],
        ['setIsLaunching', 'isLaunching', false],
        ['setError', 'error', 'Test error'],
        ['setError', 'error', undefined],
        ['setSelectedMenuIndex', 'selectedMenuIndex', 3],
      ])
    })

    test('should clear error when setting query', () => {
      store.act(s => {
        s.setError('Some error')
        s.setQuery('new query')
      })

      expect(store.getState().query).toBe('new query')
      expect(store.getState().error).toBeUndefined()
    })
  })

  describe('Workflow Actions', () => {
    test('should open launcher with correct state', () => {
      // Default mode
      store.act(s => s.openLauncher())

      let state = store.getState()
      expect(state.isOpen).toBe(true)
      expect(state.mode).toBe('command')
      expect(state.view).toBe('menu')
      expect(state.error).toBeUndefined()
      expect(state.selectedMenuIndex).toBe(0)

      // Mode is always command
      store.act(s => s.openLauncher())
      expect(store.getState().mode).toBe('command')
    })

    test('should close launcher and reset state', () => {
      // Set various states
      store.act(s => {
        s.setOpen(true)
        s.setView('input')
        s.setQuery('test')
        s.setError('error')
        s.setIsLaunching(true)
        s.setSelectedMenuIndex(2)
      })

      // Close launcher
      store.act(s => s.closeLauncher())

      testInitialState(store.getState(), {
        isOpen: false,
        view: 'menu',
        query: '',
        error: undefined,
        isLaunching: false,
        selectedMenuIndex: 0,
      })
    })

    test('should reset launcher completely', () => {
      // Modify all properties
      store.act(s => {
        s.setOpen(true)
        s.setMode('command')
        s.setView('input')
        s.setQuery('test')
        s.setError('error')
        s.setIsLaunching(true)
        s.setSelectedMenuIndex(2)
      })

      // Reset
      store.act(s => s.resetLauncher())

      testInitialState(store.getState(), {
        isOpen: false,
        mode: 'command',
        view: 'menu',
        query: '',
        isLaunching: false,
        error: undefined,
        selectedMenuIndex: 0,
      })
    })
  })

  describe('Menu Navigation', () => {
    const navigationTests = createNavigationTests([
      { current: 0, action: 'down' as any, expected: 1, total: 5 },
      { current: 4, action: 'down' as any, expected: 0, total: 5, description: 'wrap to first' },
      { current: 2, action: 'up' as any, expected: 1, total: 5 },
      { current: 0, action: 'up' as any, expected: 4, total: 5, description: 'wrap to last' },
      { current: 0, action: 'down' as any, expected: 0, total: 0, description: 'handle zero items' },
    ])

    navigationTests.forEach(([description, { current, action, expected, total }]) => {
      test(description, () => {
        store.act(s => {
          s.setSelectedMenuIndex(current)
          s.navigateMenu(action as 'up' | 'down', total)
        })
        expect(store.getState().selectedMenuIndex).toBe(expected)
      })
    })
  })

  describe('State Validation', () => {
    test('should check if launcher is ready', () => {
      // Not ready - closed
      expect(store.getState().isReady()).toBe(false)

      // Open but no query
      store.act(s => {
        s.setOpen(true)
        s.setView('input')
      })
      expect(store.getState().isReady()).toBe(false)

      // Add query - ready
      store.act(s => s.setQuery('test query'))
      expect(store.getState().isReady()).toBe(true)

      // Not ready if launching
      store.act(s => s.setIsLaunching(true))
      expect(store.getState().isReady()).toBe(false)

      // Not ready if error
      store.act(s => {
        s.setIsLaunching(false)
        s.setError('error')
      })
      expect(store.getState().isReady()).toBe(false)
    })

    test('should check if launcher has error', () => {
      expect(store.getState().hasError()).toBe(false)

      store.act(s => s.setError('Some error'))
      expect(store.getState().hasError()).toBe(true)

      store.act(s => s.setError(undefined))
      expect(store.getState().hasError()).toBe(false)
    })
  })
})
