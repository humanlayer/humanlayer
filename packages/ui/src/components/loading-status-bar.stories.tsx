import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import { Card, CardContent } from './card'
import { LoadingStatusBar } from './loading-status-bar'
import { OmniSpinner } from './omni-spinner'
import { Button } from './button'

const meta = {
	title: 'Shell Demos/LoadingStatusBar',
	component: LoadingStatusBar,
	parameters: {
		layout: 'centered',
	},
	tags: ['autodocs'],
	argTypes: {
		isLoading: {
			control: 'boolean',
			description: 'Whether the loading bar is visible',
		},
	},
} satisfies Meta<typeof LoadingStatusBar>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
	args: {
		isLoading: true,
		children: <OmniSpinner />,
	},
	render: (args) => (
		<Card className="relative w-80 h-48">
			<CardContent className="p-4">
				<div className="space-y-2">
					<div className="h-3 w-3/4 bg-muted rounded" />
					<div className="h-3 w-1/2 bg-muted rounded" />
					<div className="h-3 w-2/3 bg-muted rounded" />
				</div>
			</CardContent>
			<LoadingStatusBar {...args} />
		</Card>
	),
}

export const Interactive: Story = {
	render: () => {
		const [isLoading, setIsLoading] = useState(false)
		return (
			<div className="space-y-4">
				<Button onClick={() => setIsLoading(!isLoading)}>
					{isLoading ? 'Stop Loading' : 'Start Loading'}
				</Button>
				<Card className="relative w-80 h-48">
					<CardContent className="p-4">
						<div className="space-y-2">
							<div className="h-3 w-3/4 bg-muted rounded" />
							<div className="h-3 w-1/2 bg-muted rounded" />
							<div className="h-3 w-2/3 bg-muted rounded" />
						</div>
					</CardContent>
					<LoadingStatusBar isLoading={isLoading}>
						<OmniSpinner />
					</LoadingStatusBar>
				</Card>
			</div>
		)
	},
	parameters: {
		docs: {
			description: {
				story: 'Toggle the loading state to see the slide animation.',
			},
		},
	},
}

export const WithCustomContent: Story = {
	args: {
		isLoading: true,
		children: (
			<div className="flex items-center gap-2">
				<div className="w-2 h-2 bg-primary rounded-full animate-pulse" />
				<span>Processing request...</span>
			</div>
		),
	},
	render: (args) => (
		<Card className="relative w-80 h-48">
			<CardContent className="p-4">
				<div className="space-y-2">
					<div className="h-3 w-3/4 bg-muted rounded" />
					<div className="h-3 w-1/2 bg-muted rounded" />
				</div>
			</CardContent>
			<LoadingStatusBar {...args} />
		</Card>
	),
	parameters: {
		docs: {
			description: {
				story: 'LoadingStatusBar can contain any content, not just OmniSpinner.',
			},
		},
	},
}

export const InEventStreamContext: Story = {
	render: () => (
		<Card className="relative w-96 h-64 overflow-hidden">
			<CardContent className="p-4 pb-12">
				<div className="space-y-3">
					<div className="p-2 border-l-2 border-primary/50 bg-muted/30">
						<div className="text-xs text-muted-foreground mb-1">User</div>
						<div className="h-3 w-3/4 bg-muted rounded" />
					</div>
					<div className="p-2 border-l-2 border-secondary/50 bg-muted/30">
						<div className="text-xs text-muted-foreground mb-1">Assistant</div>
						<div className="h-3 w-full bg-muted rounded mb-1" />
						<div className="h-3 w-2/3 bg-muted rounded" />
					</div>
					<div className="p-2 border-l-2 border-accent/50 bg-muted/30">
						<div className="text-xs text-muted-foreground mb-1">Tool: Bash</div>
						<div className="h-3 w-1/2 bg-muted rounded" />
					</div>
				</div>
			</CardContent>
			<LoadingStatusBar isLoading={true}>
				<OmniSpinner />
			</LoadingStatusBar>
		</Card>
	),
	parameters: {
		docs: {
			description: {
				story: 'LoadingStatusBar in the context of an event stream, similar to how it appears in ActiveSession.',
			},
		},
	},
}
