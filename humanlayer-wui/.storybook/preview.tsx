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

// Define all available themes from App.css
const themes = [
  { value: 'solarized-dark', title: '🌙 Solarized Dark' },
  { value: 'solarized-light', title: '☀️ Solarized Light' },
  { value: 'cappuccino', title: '☕ Cappuccino' },
  { value: 'catppuccin', title: '🐱 Catppuccin' },
  { value: 'high-contrast', title: '⚡ High Contrast' },
  { value: 'framer-dark', title: '🎨 Framer Dark' },
  { value: 'framer-light', title: '🎨 Framer Light' },
  { value: 'gruvbox-dark', title: '🌲 Gruvbox Dark' },
  { value: 'gruvbox-light', title: '🌲 Gruvbox Light' },
  { value: 'monokai', title: '🎯 Monokai' },
  { value: 'launch', title: '🚀 Launch' },
  { value: 'rose-pine', title: '🌹 Rosé Pine' },
  { value: 'rose-pine-dawn', title: '🌅 Rosé Pine Dawn' },
  { value: 'rose-pine-moon', title: '🌙 Rosé Pine Moon' },
]

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    // Set dark background by default
    backgrounds: {
      default: 'dark',
      values: [
        { name: 'dark', value: '#0a0a0a' },
        { name: 'light', value: '#ffffff' },
        { name: 'transparent', value: 'transparent' },
      ],
    },
  },
  globalTypes: {
    theme: {
      name: 'Terminal Theme',
      description: 'CodeLayer terminal theme',
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
        // Set theme on documentElement for CSS variables
        document.documentElement.setAttribute('data-theme', theme)

        // Apply theme class to body for proper background
        document.body.className = 'bg-background text-foreground'

        // Get computed styles to apply background color
        const styles = getComputedStyle(document.documentElement)
        const bgColor = styles.getPropertyValue('--terminal-bg').trim()
        if (bgColor) {
          document.body.style.backgroundColor = bgColor
        }
      }, [theme])

      return (
        <div className="min-h-screen bg-background text-foreground font-mono">
          <Story />
        </div>
      )
    },
  ],
}

export default preview
