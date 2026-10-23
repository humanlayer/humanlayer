import '../src/styles/globals.css'
import type { Preview } from '@storybook/react'
import { useEffect } from 'react'

import { ThemeProvider } from '../src/components/theme-provider'
import { TooltipProvider } from '../src/components/tooltip'

// Allow Storybook Docs to serialize BigInt values in story args
BigInt.prototype.toJSON = function () {
	return this.toString()
}

// Define all available themes
const themes = [
	{ value: 'solarized-dark', title: '🌙 Solarized Dark' },
	{ value: 'solarized-light', title: '☀️ Solarized Light' },
	{ value: 'bubblegum', title: '🍬 Bubblegum' },
	{ value: 'sentry', title: '🔭 Sentry' },
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
		backgrounds: {
			default: 'dark',
			values: [
				{ name: 'dark', value: '#0a0a0a' },
				{ name: 'light', value: '#ffffff' },
				{ name: 'gray', value: '#1a1a1a' },
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
			// Persist toolbar theme selection across HMR reloads
			const theme = context.globals.theme || localStorage.getItem('storybook-toolbar-theme') || 'catppuccin'

			useEffect(() => {
				localStorage.setItem('storybook-toolbar-theme', theme)

				// Set theme on documentElement for CSS variables
				document.documentElement.setAttribute('data-theme', theme)

				// Apply theme classes to body
				document.body.classList.add('bg-background', 'text-foreground')

				// Get computed styles to apply background color
				const computedStyle = getComputedStyle(document.documentElement)
				const backgroundColor = computedStyle.getPropertyValue('--terminal-bg').trim()
				if (backgroundColor) {
					document.body.style.backgroundColor = backgroundColor
				}
			}, [theme])

			// Check if the story has centered layout
			const isLayoutCentered = context.parameters?.layout === 'centered'

			return (
				<ThemeProvider defaultTheme={theme} storageKey="storybook-theme">
					<TooltipProvider>
						<div
							className={`bg-background text-foreground font-mono ${
								isLayoutCentered ? 'flex items-center justify-center p-8' : 'min-h-screen'
							}`}
						>
							<Story />
						</div>
					</TooltipProvider>
				</ThemeProvider>
			)
		},
	],
}

export default preview
