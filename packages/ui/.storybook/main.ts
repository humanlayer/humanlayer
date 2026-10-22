import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { StorybookConfig } from '@storybook/react-vite'
import tailwindcss from '@tailwindcss/vite'
import { mergeConfig } from 'vite'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const config: StorybookConfig = {
	stories: ['../src/**/*.stories.@(js|jsx|mjs|ts|tsx)', '../storybook/**/*.stories.@(js|jsx|mjs|ts|tsx)'],
	addons: ['@chromatic-com/storybook', '@storybook/addon-docs', '@storybook/addon-a11y', '@storybook/addon-themes'],
	framework: {
		name: '@storybook/react-vite',
		options: {},
	},
	viteFinal: async (config) => {
		return mergeConfig(config, {
			plugins: [tailwindcss()],
			resolve: {
				alias: {
					'@humanlayer/ui': resolve(__dirname, '../src'),
					'@/lib/utils': resolve(__dirname, '../src/lib/utils'),
				},
			},
		})
	},
}

export default config
