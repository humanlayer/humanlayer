import type { Meta, StoryObj } from '@storybook/react-vite'
import { TokenUsageBadge } from './TokenUsageBadge'

const meta: Meta<typeof TokenUsageBadge> = {
	title: 'Components/TokenUsageBadge',
	component: TokenUsageBadge,
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
type Story = StoryObj<typeof TokenUsageBadge>

export const LowUsage: Story = {
	name: 'Low Usage (25%)',
	args: {
		contextWindowTokens: 242000,
		contextWindowLimit: 968000,
		model: 'claude-sonnet-5',
	},
}

export const WarningThreshold: Story = {
	name: 'Warning Threshold (65%)',
	args: {
		contextWindowTokens: 629200,
		contextWindowLimit: 968000,
		model: 'claude-sonnet-5',
	},
}

export const CriticalThreshold: Story = {
	name: 'Critical Threshold (92%)',
	args: {
		contextWindowTokens: 890560,
		contextWindowLimit: 968000,
		model: 'claude-sonnet-5',
	},
}

export const NearLimit: Story = {
	name: 'Near Limit (99%)',
	args: {
		contextWindowTokens: 958320,
		contextWindowLimit: 968000,
		model: 'claude-sonnet-5',
	},
}

export const NoData: Story = {
	name: 'No Data (Hidden)',
	args: {
		contextWindowTokens: undefined,
		contextWindowLimit: 968000,
	},
}

export const ZeroTokens: Story = {
	name: 'Zero Tokens (Session Start)',
	args: {
		contextWindowTokens: 0,
		contextWindowLimit: 968000,
		model: 'claude-sonnet-5',
	},
}

export const Condensed: Story = {
	name: 'Condensed (Mobile)',
	args: {
		contextWindowTokens: 45_231,
		contextWindowLimit: 168_000,
		model: 'claude-sonnet-5',
		condensed: true,
	},
}

export const CopilotPersistedLimit: Story = {
	name: 'Copilot Persisted Limit (50%)',
	args: {
		contextWindowTokens: 128000,
		contextWindowLimit: 256000,
		model: 'gpt-4o',
	},
}

export const CodexPersistedLimit: Story = {
	name: 'Codex Persisted Limit (93%)',
	args: {
		contextWindowTokens: 240000,
		contextWindowLimit: 258400,
		provider: 'codex',
		model: 'gpt-5-codex',
	},
}

export const FirepassKimiPersistedLimit: Story = {
	name: 'Firepass Kimi Persisted Limit (75%)',
	args: {
		contextWindowTokens: 96000,
		contextWindowLimit: 128000,
		model: 'accounts/fireworks/routers/kimi-k2p5-turbo',
	},
}
