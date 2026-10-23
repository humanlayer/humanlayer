import type { StorybookConfig } from '@storybook/react-vite'

const config: StorybookConfig = {
	stories: ['../src/**/*.stories.@(js|jsx|mjs|ts|tsx)'],
	addons: [],
	framework: { name: '@storybook/react-vite', options: {} },
	async viteFinal(viteConfig) {
		const { default: tailwindcss } = await import('@tailwindcss/vite')
		viteConfig.plugins = (viteConfig.plugins ?? []).filter(
			(plugin) => !plugin || !('name' in plugin) || !String(plugin.name).includes('tanstack-router'),
		)
		viteConfig.plugins.push(tailwindcss())
		viteConfig.resolve = viteConfig.resolve ?? {}
		viteConfig.resolve.dedupe = ['react', 'react-dom']
		return viteConfig
	},
}

export default config
