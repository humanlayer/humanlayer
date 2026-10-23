import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from '@storybook/test'

import { GitHubConnectSkeleton } from './GitHubConnectSkeleton'

const meta = {
	title: 'Components/GitHub/GitHubConnectSkeleton',
	component: GitHubConnectSkeleton,
	parameters: { layout: 'padded' },
	decorators: [
		(Story) => (
			<div className="flex w-[352px] flex-col gap-2 border border-border/60">
				<Story />
			</div>
		),
	],
	args: {
		repoFullName: 'humanlayer/syncopate',
		branch: 'fix-flaky-retry',
		isAdmin: true,
		orgName: 'humanlayer',
		onConnect: fn(),
	},
} satisfies Meta<typeof GitHubConnectSkeleton>

export default meta
type Story = StoryObj<typeof meta>

export const AsAdmin: Story = {}

export const AsMember: Story = {
	args: { isAdmin: false },
}

export const OrganizationNameUnknown: Story = {
	args: { orgName: null },
}

export const TwoBranches: Story = {
	render: (args) => (
		<>
			<GitHubConnectSkeleton {...args} />
			<GitHubConnectSkeleton {...args} repoFullName="humanlayer/sdk" branch="fix-flaky-retry-sdk" />
		</>
	),
}
