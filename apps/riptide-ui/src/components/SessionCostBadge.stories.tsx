import type { Meta, StoryObj } from '@storybook/react-vite'
import { SessionCostBadge } from './SessionCostBadge'

const meta: Meta<typeof SessionCostBadge> = {
	title: 'Components/SessionCostBadge',
	component: SessionCostBadge,
	parameters: {
		layout: 'centered',
	},
	decorators: [
		(Story) => (
			<div className="p-4 bg-background">
				<Story />
			</div>
		),
	],
}

export default meta
type Story = StoryObj<typeof SessionCostBadge>

export const NoCost: Story = {
	name: 'No Cost (Hidden)',
	args: {
		totalCostUsd: null,
	},
}

export const ZeroCost: Story = {
	name: 'Zero Cost',
	args: {
		totalCostUsd: 0,
	},
}

export const LowCost: Story = {
	name: 'Low Cost ($0.050)',
	args: {
		totalCostUsd: 0.05,
		modelUsage: {
			'claude-sonnet-5': {
				input_tokens: 1500,
				output_tokens: 500,
			},
		},
	},
}

export const MediumCost: Story = {
	name: 'Medium Cost ($1.234)',
	args: {
		totalCostUsd: 1.234,
		modelUsage: {
			'claude-sonnet-5': {
				input_tokens: 25000,
				output_tokens: 8000,
				cache_read_input_tokens: 5000,
			},
		},
	},
}

export const HighCost: Story = {
	name: 'High Cost ($15.678)',
	args: {
		totalCostUsd: 15.678,
		modelUsage: {
			'claude-sonnet-5': {
				input_tokens: 150000,
				output_tokens: 50000,
				cache_read_input_tokens: 30000,
				cache_creation_input_tokens: 10000,
			},
		},
	},
}

export const MultipleModels: Story = {
	name: 'Multiple Models',
	args: {
		totalCostUsd: 8.456,
		modelUsage: {
			'claude-opus-4-20250514': {
				input_tokens: 50000,
				output_tokens: 15000,
			},
			'claude-sonnet-5': {
				input_tokens: 80000,
				output_tokens: 25000,
				cache_read_input_tokens: 20000,
			},
			'claude-haiku-3-20250514': {
				input_tokens: 10000,
				output_tokens: 3000,
			},
		},
	},
}

export const NoModelUsage: Story = {
	name: 'Cost Without Model Breakdown',
	args: {
		totalCostUsd: 2.345,
		modelUsage: null,
	},
}
