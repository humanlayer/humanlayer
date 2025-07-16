import { StateCreator } from 'zustand'
import { Theme } from '@/contexts/ThemeContext'

export interface ThemeSlice {
  theme: Theme
  setTheme: (theme: Theme) => void
  cycleTheme: (direction: 'next' | 'prev') => void
  loadThemeFromStorage: () => void
  getAvailableThemes: () => Theme[]
  isDarkTheme: () => boolean
  getCurrentThemeIndex: () => number
}

const AVAILABLE_THEMES: Theme[] = [
  'solarized-dark',
  'solarized-light',
  'catppuccin',
  'framer-dark',
  'gruvbox-dark',
  'high-contrast',
]

const LIGHT_THEMES: Theme[] = ['solarized-light', 'framer-light', 'gruvbox-light']

export const createThemeSlice: StateCreator<ThemeSlice, [], [], ThemeSlice> = (set, get) => ({
  theme: 'solarized-dark',

  setTheme: theme => {
    set({ theme })
    // Update DOM for theme application
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', theme)
    }
    // Persist to localStorage
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('wui-theme', theme)
    }
  },

  cycleTheme: direction => {
    const themes = get().getAvailableThemes()
    const currentIndex = get().getCurrentThemeIndex()

    let newIndex: number
    if (direction === 'next') {
      newIndex = (currentIndex + 1) % themes.length
    } else {
      newIndex = currentIndex === 0 ? themes.length - 1 : currentIndex - 1
    }

    get().setTheme(themes[newIndex])
  },

  loadThemeFromStorage: () => {
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem('wui-theme') as Theme | null
      const availableThemes = get().getAvailableThemes()

      if (stored && availableThemes.includes(stored)) {
        get().setTheme(stored)
      } else {
        // Fall back to default
        get().setTheme('solarized-dark')
      }
    } else {
      // Fall back to default if no localStorage
      get().setTheme('solarized-dark')
    }
  },

  getAvailableThemes: () => AVAILABLE_THEMES,

  isDarkTheme: () => {
    const theme = get().theme
    return !LIGHT_THEMES.includes(theme)
  },

  getCurrentThemeIndex: () => {
    const theme = get().theme
    const themes = get().getAvailableThemes()
    return themes.indexOf(theme)
  },
})
