import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from '@storybook/test'

import { GitHubConnectPrompt } from './GitHubConnectPrompt'

const meta = {
	title: 'Components/GitHub/GitHubConnectPrompt',
	component: GitHubConnectPrompt,
	parameters: { layout: 'padded' },
	decorators: [
		(Story) => (
			<div className="w-[352px] border border-border/60">
				<Story />
			</div>
		),
	],
	args: {
		reason: 'not_connected',
		isAdmin: true,
		settingsUrl: 'https://cloud.example.com/settings',
		onOpenExternal: fn((event: React.MouseEvent) => event.preventDefault()),
		onAction: fn(),
	},
} satisfies Meta<typeof GitHubConnectPrompt>

export default meta
type Story = StoryObj<typeof meta>

export const AsAdmin: Story = {}

export const AsMember: Story = {
	args: { isAdmin: false },
}

export const IntegrationDisabled: Story = {
	args: { reason: 'disabled' },
}

export const RepositoriesWithoutTheApp: Story = {
	args: {
		reason: 'repositories_without_app',
		repositories: ['humanlayer/channels', 'copilotkit/channels-sdk', 'effect-ts/effect', 'vercel/chat'],
	},
}

export const RepositoriesWithoutTheAppAsMember: Story = {
	args: {
		reason: 'repositories_without_app',
		isAdmin: false,
		repositories: ['humanlayer/channels'],
	},
}

export const OneRepositoryWithoutTheApp: Story = {
	args: {
		reason: 'repositories_without_app',
		repositories: ['vercel/chat'],
	},
}
