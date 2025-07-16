import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { create } from 'zustand'
import { createThemeSlice, ThemeSlice, Theme } from './themeSlice'
import { createStoreTest, testInitialState } from '../test-utils'

describe('Demo ThemeSlice', () => {
  let store: ReturnType<typeof createStoreTest<ThemeSlice>>
  let storage: Record<string, string>

  beforeEach(() => {
    store = createStoreTest(() => create<ThemeSlice>()(createThemeSlice))

    // Mock localStorage
    storage = {}
    globalThis.localStorage = {
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

    // Mock document
    globalThis.document = {
      documentElement: {
        setAttribute: () => {},
      },
    } as any
  })

  afterEach(() => {
    storage = {}
  })

  describe('Initial State', () => {
    test('should initialize with default theme', () => {
      testInitialState(store.getState(), {
        theme: 'solarized-dark',
      })
    })
  })

  describe('Theme Management', () => {
    test('should set themes and update DOM', () => {
      const themes: Theme[] = ['framer-dark', 'catppuccin', 'gruvbox-dark']

      themes.forEach(theme => {
        store.testSetter('setTheme', 'theme', theme)
        expect(localStorage.getItem('wui-theme')).toBe(theme)
      })
    })

    test('should cycle through themes', () => {
      const expectedSequence = [
        { action: 'next', expected: 'solarized-light' },
        { action: 'next', expected: 'catppuccin' },
        { action: 'next', expected: 'framer-dark' },
        { action: 'next', expected: 'gruvbox-dark' },
        { action: 'next', expected: 'high-contrast' },
        { action: 'next', expected: 'solarized-dark' }, // wrap
        { action: 'prev', expected: 'high-contrast' },
        { action: 'prev', expected: 'gruvbox-dark' },
      ]

      expectedSequence.forEach(({ action, expected }) => {
        store.act(s => s.cycleTheme(action as 'next' | 'prev'))
        expect(store.getState().theme).toBe(expected as Theme)
      })
    })

    test('should load theme from localStorage', () => {
      localStorage.setItem('wui-theme', 'catppuccin')

      const newStore = createStoreTest(() => create<ThemeSlice>()(createThemeSlice))
      newStore.act(s => s.loadThemeFromStorage())

      expect(newStore.getState().theme).toBe('catppuccin')
    })

    test('should handle invalid stored theme', () => {
      localStorage.setItem('wui-theme', 'invalid-theme')

      const newStore = createStoreTest(() => create<ThemeSlice>()(createThemeSlice))
      newStore.act(s => s.loadThemeFromStorage())

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

    test('should identify dark themes', () => {
      const darkThemeTests = [
        { theme: 'solarized-dark', isDark: true },
        { theme: 'solarized-light', isDark: false },
        { theme: 'catppuccin', isDark: true },
        { theme: 'framer-dark', isDark: true },
        { theme: 'gruvbox-dark', isDark: true },
        { theme: 'high-contrast', isDark: true },
      ]

      darkThemeTests.forEach(({ theme, isDark }) => {
        store.act(s => s.setTheme(theme as Theme))
        expect(store.getState().isDarkTheme()).toBe(isDark)
      })
    })

    test('should get current theme index', () => {
      const indexTests = [
        { theme: 'solarized-dark', index: 0 },
        { theme: 'catppuccin', index: 2 },
        { theme: 'high-contrast', index: 5 },
      ]

      indexTests.forEach(({ theme, index }) => {
        store.act(s => s.setTheme(theme as Theme))
        expect(store.getState().getCurrentThemeIndex()).toBe(index)
      })
    })
  })
})
