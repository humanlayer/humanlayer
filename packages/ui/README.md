# @humanlayer/ui

Shared UI component library for the Codelayer monorepo.

## Theme Components

The theme system provides a comprehensive theming solution with 18 predefined themes and automatic persistence.

### ThemeProvider

Provides theme context to the application with localStorage persistence and optional callbacks.

```tsx
import { ThemeProvider } from '@humanlayer/ui/components/theme-provider'

<ThemeProvider
  defaultTheme="rose-pine"
  storageKey="app-theme"
  onThemeChange={(theme) => {
    // Optional callback for theme changes
    console.log('Theme changed to:', theme)
  }}
>
  {children}
</ThemeProvider>
```

**Props:**
- `defaultTheme?: Theme` - Default theme to use (default: 'rose-pine')
- `storageKey?: string` - LocalStorage key for persistence (default: 'ui-theme')
- `onThemeChange?: (theme: Theme) => void` - Callback fired when theme changes

### ThemeSelector

A dropdown UI component for theme selection with optional keyboard shortcuts.

```tsx
import { ThemeSelector } from '@humanlayer/ui/components/theme-selector'

<ThemeSelector
  showTooltip={true}
  enableHotkeys={true}
  hotkeyScope="theme"
/>
```

**Props:**
- `className?: string` - Additional CSS classes for the button
- `enableHotkeys?: boolean` - Enable keyboard shortcuts (Cmd+T) (default: false)
- `hotkeyScope?: string` - Scope for hotkeys when using react-hotkeys-hook
- `showTooltip?: boolean` - Show tooltip with current theme name (default: true)

### useTheme Hook

Access and control the current theme from any component.

```tsx
import { useTheme } from '@humanlayer/ui/hooks/use-theme'

function MyComponent() {
  const { theme, setTheme } = useTheme()

  return (
    <button onClick={() => setTheme('tokyo-night')}>
      Current theme: {theme}
    </button>
  )
}
```

### Available Themes

The following 18 themes are available:

- `solarized-dark` - Dark variant of the Solarized color scheme
- `solarized-light` - Light variant of the Solarized color scheme
- `catppuccin` - Soothing pastel theme
- `high-contrast` - High contrast for accessibility
- `framer-dark` - Framer's dark theme
- `framer-light` - Framer's light theme
- `gruvbox-dark` - Retro groove dark theme
- `gruvbox-light` - Retro groove light theme
- `monokai` - Classic Monokai theme
- `launch` - Special launch theme
- `rose-pine` - All natural pine, faux fur and a bit of soho vibes (default)
- `rose-pine-dawn` - Rosé Pine at dawn
- `rose-pine-moon` - Rosé Pine at moon
- `tokyo-night` - A clean, dark theme inspired by Tokyo night lights
- `tokyo-night-storm` - Tokyo Night storm variant
- `vesper` - Deep purple evening theme

## Usage Examples

### Basic Setup (Web App)

```tsx
// main.tsx or App.tsx
import { ThemeProvider } from '@humanlayer/ui/components/theme-provider'

function App() {
  return (
    <ThemeProvider defaultTheme="rose-pine">
      <YourApp />
    </ThemeProvider>
  )
}
```

### With Tauri Integration

```tsx
// For Tauri apps that need window background sync
import { ThemeProvider } from '@humanlayer/ui/components/theme-provider'
import { syncWindowBackgroundWithTheme } from './lib/windowTheme'

function App() {
  return (
    <ThemeProvider
      defaultTheme="rose-pine"
      onThemeChange={() => {
        // Sync Tauri window background on macOS
        try {
          syncWindowBackgroundWithTheme('main')
        } catch (error) {
          // Ignore in non-Tauri environments
        }
      }}
    >
      <YourApp />
    </ThemeProvider>
  )
}
```

### In a Header Component

```tsx
import { ThemeSelector } from '@humanlayer/ui/components/theme-selector'

function Header() {
  return (
    <header className="flex justify-between items-center p-4">
      <h1>My App</h1>
      <ThemeSelector showTooltip={true} />
    </header>
  )
}
```

## Implementation Details

### CSS Variables

Themes work by setting CSS custom properties on the document root element via a `data-theme` attribute. All theme colors are defined in `@humanlayer/ui/globals.css`.

### Storage

Theme selection is automatically persisted to localStorage. Each app can use a different storage key to maintain separate theme preferences.

### Performance

- Theme switching is instant as it only updates CSS variables
- No JavaScript re-rendering of components
- Minimal localStorage access (only on mount and change)
- 10ms delay on callbacks to ensure CSS is computed

## Migrating from Local Theme Implementation

If you have an existing theme implementation:

1. Remove local ThemeContext/ThemeProvider files
2. Update imports to use `@humanlayer/ui/components/theme-provider`
3. Update ThemeSelector imports to `@humanlayer/ui/components/theme-selector`
4. Keep the same localStorage key for backwards compatibility
5. Add any app-specific logic via the `onThemeChange` callback
