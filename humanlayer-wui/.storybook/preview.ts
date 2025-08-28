import type { Preview } from '@storybook/react'
import '../src/App.css'

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    backgrounds: {
      default: 'solarized-dark',
      values: [
        {
          name: 'solarized-dark',
          value: '#002b36',
        },
        {
          name: 'solarized-light',
          value: '#fdf6e3',
        },
        {
          name: 'cappuccino',
          value: '#2f1b14',
        },
        {
          name: 'catppuccin',
          value: '#1e1e2e',
        },
        {
          name: 'high-contrast',
          value: '#000000',
        },
        {
          name: 'framer-dark',
          value: '#181818',
        },
        {
          name: 'framer-light',
          value: '#ffffff',
        },
        {
          name: 'gruvbox-dark',
          value: '#282828',
        },
        {
          name: 'gruvbox-light',
          value: '#fbf1c7',
        },
        {
          name: 'monokai',
          value: '#272822',
        },
        {
          name: 'launch',
          value: '#f6f6ef',
        },
        {
          name: 'rose-pine',
          value: '#191724',
        },
        {
          name: 'rose-pine-dawn',
          value: '#faf4ed',
        },
        {
          name: 'rose-pine-moon',
          value: '#232136',
        },
      ],
    },
  },
  globalTypes: {
    theme: {
      description: 'Global theme for components',
      defaultValue: 'solarized-dark',
      toolbar: {
        title: 'Theme',
        icon: 'paintbrush',
        items: [
          { value: 'solarized-dark', title: 'Solarized Dark' },
          { value: 'solarized-light', title: 'Solarized Light' },
          { value: 'cappuccino', title: 'Cappuccino' },
          { value: 'catppuccin', title: 'Catppuccin' },
          { value: 'high-contrast', title: 'High Contrast' },
          { value: 'framer-dark', title: 'Framer Dark' },
          { value: 'framer-light', title: 'Framer Light' },
          { value: 'gruvbox-dark', title: 'Gruvbox Dark' },
          { value: 'gruvbox-light', title: 'Gruvbox Light' },
          { value: 'monokai', title: 'Monokai' },
          { value: 'launch', title: 'Launch' },
          { value: 'rose-pine', title: 'Rosé Pine' },
          { value: 'rose-pine-dawn', title: 'Rosé Pine Dawn' },
          { value: 'rose-pine-moon', title: 'Rosé Pine Moon' },
        ],
        dynamicTitle: true,
      },
    },
  },
  decorators: [
    (Story, context) => {
      const theme = context.globals.theme || 'solarized-dark'

      // Apply theme to document element for CSS variables
      if (typeof document !== 'undefined') {
        document.documentElement.setAttribute('data-theme', theme)
      }

      return Story()
    },
  ],
}

export default preview
