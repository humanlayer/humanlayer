import type { Preview } from '@storybook/react'
import '../src/App.css'
import React from 'react'
import { useEffect } from 'react'

// Mock Tauri
if (typeof window !== 'undefined') {
  ;(window as any).__TAURI_INTERNALS__ = {
    postMessage: () => {},
    ipc: () => {},
  }
}

// Define available themes
const themes = [
  { value: 'solarized-dark', title: 'Solarized Dark' },
  { value: 'solarized-light', title: 'Solarized Light' },
  { value: 'catppuccin', title: 'Catppuccin' },
  { value: 'gruvbox-dark', title: 'Gruvbox Dark' },
]

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
  globalTypes: {
    theme: {
      name: 'Theme',
      description: 'Terminal theme',
      defaultValue: 'catppuccin',
      toolbar: {
        icon: 'paintbrush',
        items: themes,
        showName: true,
        dynamicTitle: true,
      },
    },
  },
  decorators: [
    (Story, context) => {
      const theme = context.globals.theme || 'catppuccin'

      useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme)
        // Also set background color to match theme
        const styles = getComputedStyle(document.documentElement)
        const bgColor = styles.getPropertyValue('--terminal-bg').trim()
        if (bgColor) {
          document.body.style.backgroundColor = bgColor
        }
      }, [theme])

      return (
        <div className="min-h-screen bg-background text-foreground">
          <Story />
        </div>
      )
    },
  ],
}

export default preview
