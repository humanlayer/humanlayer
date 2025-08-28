import type { StorybookConfig } from '@storybook/react-vite'

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(js|jsx|mjs|ts|tsx)'],
  addons: [
    '@storybook/addon-links',
    '@storybook/addon-essentials',
    '@storybook/addon-onboarding',
    '@storybook/addon-interactions',
  ],
  framework: {
    name: '@storybook/react-vite',
    options: {
      builder: {
        viteConfigPath: './vite.config.ts',
      },
    },
  },
  docs: {
    autodocs: 'tag',
  },
  typescript: {
    check: false,
    reactDocgen: 'react-docgen-typescript',
    reactDocgenTypescriptOptions: {
      shouldExtractLiteralValuesFromEnum: true,
      propFilter: prop => (prop.parent ? !/node_modules/.test(prop.parent.fileName) : true),
    },
  },
  viteFinal: async config => {
    // Import required modules
    const { mergeConfig } = await import('vite')
    const react = (await import('@vitejs/plugin-react')).default
    const tailwindcss = (await import('@tailwindcss/vite')).default
    const path = await import('path')

    // Create minimal vite config for Storybook compatibility
    return mergeConfig(config, {
      plugins: [...(config.plugins || []), react(), tailwindcss()],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '../src'),
        },
      },
      define: {
        // Prevent issues with process.env in the browser
        'process.env': {},
      },
    })
  },
}

export default config
