import type { StorybookConfig } from '@storybook/react-vite';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { mergeConfig } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const config: StorybookConfig = {
	stories: ['../src/**/*.stories.@(js|jsx|ts|tsx|mdx)'],
	addons: ['@storybook/addon-themes'],
	framework: {
		name: '@storybook/react-vite',
		options: {},
	},
	viteFinal: async (config) => {
		// Merge with app's vite config for consistent behavior
		return mergeConfig(config, {
			resolve: {
				alias: {
					'@': resolve(__dirname, '../src'),
				},
			},
			plugins: [
				// Tailwind CSS v4 plugin is automatically included from dependencies
			],
		});
	},
};

export default config;
