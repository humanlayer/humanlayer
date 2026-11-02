import * as React from 'react'
import { useLocalStorage } from '../hooks/use-local-storage'

export type Theme =
  | 'solarized-dark'
  | 'solarized-light'
  | 'bubblegum'
  | 'sentry'
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
  | 'tokyo-night'
  | 'tokyo-night-storm'
  | 'vesper'
  | 'rapture'
  | 'tactical'
  | 'neuromancer'
  | 'red-alert'
  | 'covenant'
  | 'wintermute'
  | 'dash'
  | 'wednesday'
  | 'tokyo-night-light-vscode'
  | 'poimandres-vscode'
  | 'night-owl-light-vscode'
  | 'nord-vscode'
  | 'vercel-dark-vscode'

interface ThemeContextType {
  theme: Theme
  setTheme: (theme: Theme) => void
}

const ThemeContext = React.createContext<ThemeContextType | undefined>(undefined)

interface ThemeProviderProps {
  children: React.ReactNode
  defaultTheme?: Theme
  storageKey?: string
  onThemeChange?: (theme: Theme) => void
}

export function ThemeProvider({
  children,
  defaultTheme = 'rose-pine',
  storageKey = 'ui-theme',
  onThemeChange,
}: ThemeProviderProps) {
  const [theme, setTheme, isLoaded] = useLocalStorage(storageKey, defaultTheme)

  React.useEffect(() => {
    if (!isLoaded) return

    localStorage.setItem(storageKey, JSON.stringify(theme))
    document.documentElement.setAttribute('data-theme', theme)

    // Call optional callback for app-specific integration (e.g., Tauri)
    if (!onThemeChange) return
    const timeout = setTimeout(() => {
      onThemeChange(theme)
    }, 10)
    // A report still pending when the theme or callback changes is stale; dropping it keeps
    // it from overwriting whatever owns the window theme now.
    return () => clearTimeout(timeout)
  }, [theme, storageKey, onThemeChange, isLoaded])

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const context = React.useContext(ThemeContext)
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}

/** Like useTheme, but returns undefined outside a ThemeProvider (tests, isolated
 * renders) so consumers can fall back to a default theme instead of throwing. */
export function useOptionalTheme() {
  return React.useContext(ThemeContext)
}
