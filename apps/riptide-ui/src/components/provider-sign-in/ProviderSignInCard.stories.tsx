import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from '@storybook/test'

import { ProviderSignInCard, type ProviderSignInRequest } from './ProviderSignInCard'

const meta: Meta<typeof ProviderSignInCard> = {
	title: 'Components/ProviderSignInCard',
	component: ProviderSignInCard,
	parameters: { layout: 'padded' },
	decorators: [
		(Story) => (
			<div className="w-full max-w-xl bg-background p-4">
				<Story />
			</div>
		),
	],
	args: {
		provider: 'claude',
		variant: 'card',
		host: { state: 'ready' },
		isStarting: false,
		request: null,
		onSignIn: fn(),
		onCancel: fn(),
		onSubmitCode: fn(),
		onOpenUrl: fn(),
		onOpenDaemonSettings: fn(),
	},
}

export default meta
type Story = StoryObj<typeof ProviderSignInCard>

const request = (overrides: Partial<ProviderSignInRequest>): ProviderSignInRequest => ({
	id: 'req-1',
	status: 'requested',
	url: null,
	userCode: null,
	submittedCode: null,
	error: null,
	accountLabel: null,
	...overrides,
})

export const NotSignedIn: Story = {}

export const NoHost: Story = { args: { host: { state: 'offline' } } }

export const OutdatedHost: Story = { args: { host: { state: 'outdated', daemonVersion: '0.31.173-dev.0' } } }

export const Starting: Story = { args: { request: request({ status: 'requested' }) } }

export const ClaudeAwaitingCode: Story = {
	args: {
		request: request({ status: 'awaiting_approval', url: 'https://claude.ai/oauth/authorize?code=true' }),
	},
}

export const ClaudeCheckingCode: Story = {
	args: {
		request: request({
			status: 'awaiting_approval',
			url: 'https://claude.ai/oauth/authorize?code=true',
			submittedCode: 'abc123',
		}),
	},
}

export const ClaudeWrongCode: Story = {
	args: {
		request: request({
			status: 'awaiting_approval',
			url: 'https://claude.ai/oauth/authorize?code=true',
			error: 'Could not sign in to Claude. The code was incomplete. Copy the full code and try again.',
		}),
	},
}

export const CodexDeviceCode: Story = {
	args: {
		provider: 'codex',
		request: request({
			status: 'awaiting_approval',
			url: 'https://auth.openai.com/codex/device',
			userCode: 'K7PQ-M3XZ',
		}),
	},
}

export const SignedIn: Story = {
	args: {
		request: request({ status: 'succeeded', accountLabel: 'Signed in as dev@example.com · max plan' }),
	},
}

export const Failed: Story = {
	args: {
		request: request({ status: 'failed', error: 'Sign-in timed out. Start again when you are ready.' }),
	},
}

export const Inline: Story = {
	args: {
		variant: 'inline',
		request: request({ status: 'awaiting_approval', url: 'https://claude.ai/oauth/authorize?code=true' }),
	},
}
