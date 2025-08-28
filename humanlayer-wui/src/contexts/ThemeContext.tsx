import React, { createContext, useContext, useState, useEffect } from 'react'
import { THEME_STORAGE_KEY, getStorageItem, setStorageItem } from '../lib/storage-keys'

export type Theme =
  | 'solarized-dark'
  | 'solarized-light'
  | 'cappuccino'
  | 'catppuccin'
  | 'high-contrast'
  | 'framer-dark'
  | 'framer-light'
  | 'gruvbox-dark'
  | 'gruvbox-light'
  | 'monokai'
  | 'launch'
  | 'rose-pine'
  | 'rose-pine-dawn'
  | 'rose-pine-moon'

interface ThemeContextType {
  theme: Theme
  setTheme: (theme: Theme) => void
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = getStorageItem(THEME_STORAGE_KEY)
    return (stored as Theme) || 'catppuccin'
  })

  useEffect(() => {
    setStorageItem(THEME_STORAGE_KEY, theme)
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}
