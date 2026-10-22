import { ThemeProvider } from '@humanlayer/ui/components/theme-provider'
import { TooltipProvider } from '@humanlayer/ui/components/tooltip'
import type { Preview } from '@storybook/react-vite'

import '../src/styles.css'

const preview: Preview = {
	parameters: {
		layout: 'padded',
		backgrounds: {
			default: 'light',
			values: [
				{ name: 'light', value: '#f8fafc' },
				{ name: 'dark', value: '#111827' },
			],
		},
	},
	decorators: [
		(Story) => (
			<ThemeProvider defaultTheme="light" storageKey="riptide-cloud-storybook-theme">
				<TooltipProvider>
					<div className="mx-auto max-w-3xl rounded-xl bg-background p-6 text-foreground shadow-sm">
						<Story />
					</div>
				</TooltipProvider>
			</ThemeProvider>
		),
	],
}

export default preview
