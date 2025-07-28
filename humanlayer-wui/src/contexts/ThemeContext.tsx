import React, { createContext, useContext, useState, useEffect } from 'react'

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

interface ThemeContextType {
  theme: Theme
  setTheme: (theme: Theme) => void
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = localStorage.getItem('wui-theme')
    return (stored as Theme) || 'catppuccin'
  })

  useEffect(() => {
    localStorage.setItem('wui-theme', theme)
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
