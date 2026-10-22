import type { Meta, StoryObj } from '@storybook/react-vite'
import { CodingAgentBadge } from './coding-agent-badge'

const meta = {
	title: 'UI/CodingAgentBadge',
	component: CodingAgentBadge,
	parameters: {
		layout: 'centered',
	},
	tags: ['autodocs'],
} satisfies Meta<typeof CodingAgentBadge>

export default meta
type Story = StoryObj<typeof meta>

export const ClaudeCode: Story = {
	args: {
		codingAgent: 'claude',
	},
}

export const CodeLayerWithProvider: Story = {
	args: {
		codingAgent: 'codelayer',
		provider: 'codex',
	},
}

export const AllVariants: Story = {
	render: () => (
		<div className="flex flex-wrap items-center gap-2 p-8">
			<CodingAgentBadge codingAgent="claude" />
			<CodingAgentBadge codingAgent="codelayer" provider="codex" />
			<CodingAgentBadge codingAgent="codelayer" />
			<CodingAgentBadge codingAgent="opencode" />
		</div>
	),
}
