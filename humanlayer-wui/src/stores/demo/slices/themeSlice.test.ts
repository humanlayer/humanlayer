import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { create, StoreApi } from 'zustand'
import { createThemeSlice, ThemeSlice } from './themeSlice'

// Helper to create a test store with just the theme slice
function createTestStore(): StoreApi<ThemeSlice> {
  return create<ThemeSlice>()(createThemeSlice)
}

describe('Demo ThemeSlice', () => {
  let store: StoreApi<ThemeSlice>
  let storage: Record<string, string>

  beforeEach(() => {
    store = createTestStore()

    // Mock localStorage
    storage = {}
    global.localStorage = {
      getItem: (key: string) => storage[key] || null,
      setItem: (key: string, value: string) => {
        storage[key] = value
      },
      removeItem: (key: string) => {
        delete storage[key]
      },
      clear: () => {
        storage = {}
      },
      length: 0,
      key: () => null,
    }

    // Mock document.documentElement.setAttribute
    global.document = {
      documentElement: {
        setAttribute: () => {},
      },
    } as any
  })

  afterEach(() => {
    // Clean up
    storage = {}
  })

  describe('Initial State', () => {
    test('should initialize with default theme', () => {
      const state = store.getState()
      expect(state.theme).toBe('solarized-dark')
    })
  })

  describe('Theme Management', () => {
    test('should set theme', () => {
      store.getState().setTheme('catppuccin')
      expect(store.getState().theme).toBe('catppuccin')
    })

    test('should update DOM when setting theme', () => {
      let capturedTheme: string | null = null
      document.documentElement.setAttribute = (attr: string, value: string) => {
        if (attr === 'data-theme') capturedTheme = value
      }

      store.getState().setTheme('framer-dark')
      expect(capturedTheme).toBe('framer-dark')
    })

    test('should persist theme to localStorage', () => {
      store.getState().setTheme('gruvbox-dark')
      expect(localStorage.getItem('wui-theme')).toBe('gruvbox-dark')
    })

    test('should cycle through themes', () => {
      const themes = [
        'solarized-dark',
        'solarized-light',
        'catppuccin',
        'framer-dark',
        'gruvbox-dark',
        'high-contrast',
      ]

      // Start at solarized-dark
      expect(store.getState().theme).toBe('solarized-dark')

      // Cycle forward through all themes
      store.getState().cycleTheme('next')
      expect(store.getState().theme).toBe('solarized-light')

      store.getState().cycleTheme('next')
      expect(store.getState().theme).toBe('catppuccin')

      store.getState().cycleTheme('next')
      expect(store.getState().theme).toBe('framer-dark')

      store.getState().cycleTheme('next')
      expect(store.getState().theme).toBe('gruvbox-dark')

      store.getState().cycleTheme('next')
      expect(store.getState().theme).toBe('high-contrast')

      // Should wrap to beginning
      store.getState().cycleTheme('next')
      expect(store.getState().theme).toBe('solarized-dark')
    })

    test('should cycle backwards through themes', () => {
      // Start at solarized-dark
      expect(store.getState().theme).toBe('solarized-dark')

      // Cycle backward - should wrap to end
      store.getState().cycleTheme('prev')
      expect(store.getState().theme).toBe('high-contrast')

      store.getState().cycleTheme('prev')
      expect(store.getState().theme).toBe('gruvbox-dark')
    })

    test('should load theme from localStorage on init', () => {
      // Set a theme in localStorage before creating store
      localStorage.setItem('wui-theme', 'catppuccin')

      // Create new store
      const newStore = createTestStore()

      // Call loadThemeFromStorage after store is created
      newStore.getState().loadThemeFromStorage()

      expect(newStore.getState().theme).toBe('catppuccin')
    })

    test('should fall back to default if stored theme is invalid', () => {
      // Set invalid theme in localStorage
      localStorage.setItem('wui-theme', 'invalid-theme')

      // Create new store
      const newStore = createTestStore()

      // Call loadThemeFromStorage after store is created
      newStore.getState().loadThemeFromStorage()

      expect(newStore.getState().theme).toBe('solarized-dark')
    })
  })

  describe('Theme Utilities', () => {
    test('should get available themes', () => {
      const themes = store.getState().getAvailableThemes()
      expect(themes).toEqual([
        'solarized-dark',
        'solarized-light',
        'catppuccin',
        'framer-dark',
        'gruvbox-dark',
        'high-contrast',
      ])
    })

    test('should check if theme is dark', () => {
      store.getState().setTheme('solarized-dark')
      expect(store.getState().isDarkTheme()).toBe(true)

      store.getState().setTheme('solarized-light')
      expect(store.getState().isDarkTheme()).toBe(false)

      store.getState().setTheme('catppuccin')
      expect(store.getState().isDarkTheme()).toBe(true)

      store.getState().setTheme('framer-dark')
      expect(store.getState().isDarkTheme()).toBe(true)

      store.getState().setTheme('gruvbox-dark')
      expect(store.getState().isDarkTheme()).toBe(true)

      store.getState().setTheme('high-contrast')
      expect(store.getState().isDarkTheme()).toBe(true)
    })

    test('should get current theme index', () => {
      store.getState().setTheme('solarized-dark')
      expect(store.getState().getCurrentThemeIndex()).toBe(0)

      store.getState().setTheme('catppuccin')
      expect(store.getState().getCurrentThemeIndex()).toBe(2)

      store.getState().setTheme('high-contrast')
      expect(store.getState().getCurrentThemeIndex()).toBe(5)
    })
  })
})
