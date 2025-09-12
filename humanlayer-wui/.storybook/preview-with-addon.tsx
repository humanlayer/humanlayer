import type { Preview } from '@storybook/react'
import { withThemeByDataAttribute } from '@storybook/addon-themes'
import '../src/App.css'
import React from 'react'

// Mock Tauri
if (typeof window !== 'undefined') {
  ;(window as any).__TAURI_INTERNALS__ = {
    postMessage: () => {},
    ipc: () => {},
  }
}

// Define all available themes
export const allThemes = {
  'solarized-dark': '🌙 Solarized Dark',
  'solarized-light': '☀️ Solarized Light',
  'cappuccino': '☕ Cappuccino',
  'catppuccin': '🐱 Catppuccin',
  'high-contrast': '⚡ High Contrast',
  'framer-dark': '🎨 Framer Dark',
  'framer-light': '🎨 Framer Light',
  'gruvbox-dark': '🌲 Gruvbox Dark',
  'gruvbox-light': '🌲 Gruvbox Light',
  'monokai': '🎯 Monokai',
  'launch': '🚀 Launch',
  'rose-pine': '🌹 Rosé Pine',
  'rose-pine-dawn': '🌅 Rosé Pine Dawn',
  'rose-pine-moon': '🌙 Rosé Pine Moon',
}

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    backgrounds: {
      disable: true, // Disable backgrounds addon since themes handle this
    },
  },
  decorators: [
    // Use the official theme addon decorator
    withThemeByDataAttribute({
      themes: allThemes,
      defaultTheme: 'catppuccin',
      attributeName: 'data-theme',
    }),
    // Additional decorator to ensure proper styling
    (Story) => (
      <div className="min-h-screen bg-background text-foreground font-mono p-4">
        <Story />
      </div>
    ),
  ],
}

export default preview