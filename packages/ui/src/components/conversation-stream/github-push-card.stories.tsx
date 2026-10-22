import type { Meta, StoryObj } from '@storybook/react'
import { fn } from 'storybook/test'

import { GitHubPushCard } from './github-push-card'

const meta = {
	title: 'ConversationStream/GitHubPushCard',
	component: GitHubPushCard,
	args: {
		onConnect: fn(),
		onLater: fn(),
		onOpenGitHubTab: fn(),
	},
} satisfies Meta<typeof GitHubPushCard>

export default meta
type Story = StoryObj<typeof meta>

export const NotConnected: Story = {
	args: {
		state: { kind: 'not_connected', branch: 'fix-flaky-retry', repoFullName: 'humanlayer/syncopate' },
	},
}

export const DraftPullRequestWithChecks: Story = {
	args: {
		state: { kind: 'pull_request', branch: 'fix-flaky-retry', number: 2611, isDraft: true, checkCount: 12 },
	},
}

export const PullRequestChecksUncounted: Story = {
	args: {
		state: { kind: 'pull_request', branch: 'fix-flaky-retry', number: 2611, isDraft: false, checkCount: null },
	},
}
