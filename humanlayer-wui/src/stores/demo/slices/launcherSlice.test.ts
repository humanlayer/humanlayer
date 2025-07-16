import { describe, test, expect, beforeEach } from 'bun:test'
import { create, StoreApi } from 'zustand'
import { createLauncherSlice, LauncherSlice } from './launcherSlice'

// Helper to create a test store with just the launcher slice
function createTestStore(): StoreApi<LauncherSlice> {
  return create<LauncherSlice>()(createLauncherSlice)
}

describe('Demo LauncherSlice', () => {
  let store: StoreApi<LauncherSlice>

  beforeEach(() => {
    store = createTestStore()
  })

  describe('Initial State', () => {
    test('should initialize with correct defaults', () => {
      const state = store.getState()
      expect(state.isOpen).toBe(false)
      expect(state.mode).toBe('command')
      expect(state.view).toBe('menu')
      expect(state.query).toBe('')
      expect(state.isLaunching).toBe(false)
      expect(state.error).toBeUndefined()
      expect(state.selectedMenuIndex).toBe(0)
    })
  })

  describe('Basic State Updates', () => {
    test('should set open state', () => {
      store.getState().setOpen(true)
      expect(store.getState().isOpen).toBe(true)

      store.getState().setOpen(false)
      expect(store.getState().isOpen).toBe(false)
    })

    test('should set mode', () => {
      store.getState().setMode('search')
      expect(store.getState().mode).toBe('search')

      store.getState().setMode('command')
      expect(store.getState().mode).toBe('command')
    })

    test('should set view', () => {
      store.getState().setView('input')
      expect(store.getState().view).toBe('input')

      store.getState().setView('menu')
      expect(store.getState().view).toBe('menu')
    })

    test('should set query', () => {
      store.getState().setQuery('test query')
      expect(store.getState().query).toBe('test query')
    })

    test('should clear error when setting query', () => {
      // Set an error first
      store.getState().setError('Some error')
      expect(store.getState().error).toBe('Some error')

      // Setting query should clear error
      store.getState().setQuery('new query')
      expect(store.getState().query).toBe('new query')
      expect(store.getState().error).toBeUndefined()
    })

    test('should set launching state', () => {
      store.getState().setIsLaunching(true)
      expect(store.getState().isLaunching).toBe(true)

      store.getState().setIsLaunching(false)
      expect(store.getState().isLaunching).toBe(false)
    })

    test('should set error', () => {
      store.getState().setError('Test error')
      expect(store.getState().error).toBe('Test error')

      store.getState().setError(undefined)
      expect(store.getState().error).toBeUndefined()
    })

    test('should set selected menu index', () => {
      store.getState().setSelectedMenuIndex(3)
      expect(store.getState().selectedMenuIndex).toBe(3)
    })
  })

  describe('Workflow Actions', () => {
    test('should open launcher with default mode', () => {
      store.getState().openLauncher()

      const state = store.getState()
      expect(state.isOpen).toBe(true)
      expect(state.mode).toBe('command')
      expect(state.view).toBe('menu')
      expect(state.error).toBeUndefined()
      expect(state.selectedMenuIndex).toBe(0)
    })

    test('should open launcher with specific mode', () => {
      store.getState().openLauncher('search')

      const state = store.getState()
      expect(state.isOpen).toBe(true)
      expect(state.mode).toBe('search')
      expect(state.view).toBe('menu')
    })

    test('should close launcher and reset state', () => {
      // Set some state first
      store.getState().setOpen(true)
      store.getState().setView('input')
      store.getState().setQuery('test')
      store.getState().setError('error')
      store.getState().setIsLaunching(true)
      store.getState().setSelectedMenuIndex(2)

      // Close launcher
      store.getState().closeLauncher()

      const state = store.getState()
      expect(state.isOpen).toBe(false)
      expect(state.view).toBe('menu')
      expect(state.query).toBe('')
      expect(state.error).toBeUndefined()
      expect(state.isLaunching).toBe(false)
      expect(state.selectedMenuIndex).toBe(0)
    })

    test('should reset launcher to initial state', () => {
      // Set some state first
      store.getState().setOpen(true)
      store.getState().setMode('search')
      store.getState().setView('input')
      store.getState().setQuery('test')
      store.getState().setError('error')
      store.getState().setIsLaunching(true)
      store.getState().setSelectedMenuIndex(2)

      // Reset launcher
      store.getState().resetLauncher()

      const state = store.getState()
      expect(state.isOpen).toBe(false)
      expect(state.mode).toBe('command')
      expect(state.view).toBe('menu')
      expect(state.query).toBe('')
      expect(state.isLaunching).toBe(false)
      expect(state.error).toBeUndefined()
      expect(state.selectedMenuIndex).toBe(0)
    })
  })

  describe('Menu Navigation', () => {
    test('should navigate to next menu item', () => {
      store.getState().setSelectedMenuIndex(0)
      store.getState().navigateMenu('down', 5) // 5 total items

      expect(store.getState().selectedMenuIndex).toBe(1)
    })

    test('should wrap to first item when navigating down from last', () => {
      store.getState().setSelectedMenuIndex(4)
      store.getState().navigateMenu('down', 5) // 5 total items

      expect(store.getState().selectedMenuIndex).toBe(0)
    })

    test('should navigate to previous menu item', () => {
      store.getState().setSelectedMenuIndex(2)
      store.getState().navigateMenu('up', 5) // 5 total items

      expect(store.getState().selectedMenuIndex).toBe(1)
    })

    test('should wrap to last item when navigating up from first', () => {
      store.getState().setSelectedMenuIndex(0)
      store.getState().navigateMenu('up', 5) // 5 total items

      expect(store.getState().selectedMenuIndex).toBe(4)
    })

    test('should handle navigation with zero items', () => {
      store.getState().setSelectedMenuIndex(0)
      store.getState().navigateMenu('down', 0)

      expect(store.getState().selectedMenuIndex).toBe(0)
    })
  })

  describe('State Validation', () => {
    test('should check if launcher is ready', () => {
      // Initially not ready (closed)
      expect(store.getState().isReady()).toBe(false)

      // Open but no query
      store.getState().setOpen(true)
      store.getState().setView('input')
      expect(store.getState().isReady()).toBe(false)

      // Add query - now ready
      store.getState().setQuery('test query')
      expect(store.getState().isReady()).toBe(true)

      // But not if launching
      store.getState().setIsLaunching(true)
      expect(store.getState().isReady()).toBe(false)

      // Or if there's an error
      store.getState().setIsLaunching(false)
      store.getState().setError('error')
      expect(store.getState().isReady()).toBe(false)
    })

    test('should check if launcher has error', () => {
      expect(store.getState().hasError()).toBe(false)

      store.getState().setError('Some error')
      expect(store.getState().hasError()).toBe(true)

      store.getState().setError(undefined)
      expect(store.getState().hasError()).toBe(false)
    })
  })
})
