import type { StorybookConfig } from '@storybook/react-vite'

const config: StorybookConfig = {
	stories: ['../src/**/*.stories.@(js|jsx|mjs|ts|tsx)'],
	addons: [],
	framework: {
		name: '@storybook/react-vite',
		options: {},
	},
	async viteFinal(config) {
		const { default: tailwindcss } = await import('@tailwindcss/vite')
		const { devtools } = await import('@tanstack/devtools-vite')

		// @storybook/react-vite automatically merges plugins from vite.config.ts.
		// This includes @tanstack/devtools-vite, which starts an event bus server
		// on a hardcoded port (42069 by default). When both `bun run dev` and
		// `bun run storybook` run simultaneously, they fight over this port.
		//
		// Fix: Remove the inherited devtools plugin and add our own with a unique port.
		config.plugins = (config.plugins || []).filter(
			(p) => !p || !('name' in p) || !String(p.name).includes('devtools'),
		)
		config.plugins.push(tailwindcss())
		config.plugins.push(
			...devtools({
				eventBusConfig: {
					// Use a different port than vite.config.ts (42070) to avoid EADDRINUSE
					port: Number(process.env.RIPTIDE_UI_STORYBOOK_TANSTACK_DEVTOOLS_PORT) || 42071,
				},
			}),
		)

		// Dedupe React to prevent "Cannot read properties of null (reading 'useState')" error
		// when using components from @humanlayer/ui that import their own React
		config.resolve = config.resolve || {}
		config.resolve.dedupe = ['react', 'react-dom', 'react-hotkeys-hook']

		return config
	},
}
export default config
