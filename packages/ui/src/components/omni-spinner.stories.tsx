import type { Meta, StoryObj } from '@storybook/react'
import { OmniSpinner } from './omni-spinner'

const meta = {
	title: 'Components/OmniSpinner',
	component: OmniSpinner,
	parameters: {
		layout: 'centered',
	},
	tags: ['autodocs'],
	argTypes: {
		showVerb: {
			control: 'boolean',
			description: 'Whether to show the animated verb text',
		},
	},
} satisfies Meta<typeof OmniSpinner>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
	args: {
		showVerb: true,
	},
}

export const SpinnerOnly: Story = {
	args: {
		showVerb: false,
	},
	parameters: {
		docs: {
			description: {
				story: 'OmniSpinner without the verb text, useful for compact layouts.',
			},
		},
	},
}

export const CustomVerbs: Story = {
	args: {
		showVerb: true,
		verbs: ['loading', 'processing', 'thinking', 'computing', 'analyzing'],
	},
	parameters: {
		docs: {
			description: {
				story: 'OmniSpinner with a custom verb list.',
			},
		},
	},
}

export const InContext: Story = {
	render: () => (
		<div className="border border-border rounded-md p-4 w-80 bg-background">
			<div className="space-y-2 mb-4">
				<div className="h-3 w-3/4 bg-muted rounded" />
				<div className="h-3 w-1/2 bg-muted rounded" />
			</div>
			<div className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
				<OmniSpinner />
			</div>
		</div>
	),
	parameters: {
		docs: {
			description: {
				story: 'OmniSpinner shown in context with typical status bar styling.',
			},
		},
	},
}
