import type { PullRequestRowType } from '@humanlayer/streams/pr-status'
import type { Meta, StoryObj } from '@storybook/react-vite'

import { PullRequestStatusBlock } from './PullRequestStatusBlock'

const pullRequest: PullRequestRowType = {
	id: 'humanlayer/syncopate:integrate-github-pr-status-and-checks-display',
	number: 2261,
	title: 'Show GitHub pull request status and checks in the session sidebar',
	url: 'https://github.com/humanlayer/syncopate/pull/2261',
	state: 'open',
	isDraft: false,
	headRef: 'integrate-github-pr-status-and-checks-display',
	baseRef: 'main',
	headSha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
	mergeable: true,
	reviewDecision: 'REVIEW_REQUIRED',
	unresolvedThreadCount: null,
	resolvedThreadCount: null,
	changesRequestedReviews: null,
}

const meta = {
	title: 'Components/GitHub/PullRequestStatusBlock',
	component: PullRequestStatusBlock,
	parameters: { layout: 'padded' },
	// The panel is resizable from a 200px floor to 60% of the content area, so the block has to
	// survive the floor. The default frame is the prototype's 352px.
	decorators: [
		(Story) => (
			<div className="w-[352px] border border-border/60 p-2">
				<Story />
			</div>
		),
	],
	args: { pullRequest, branch: pullRequest.headRef },
} satisfies Meta<typeof PullRequestStatusBlock>

export default meta
type Story = StoryObj<typeof meta>

export const Ready: Story = {}

export const Draft: Story = {
	args: { pullRequest: { ...pullRequest, isDraft: true, reviewDecision: null } },
}

export const Conflicting: Story = {
	args: { pullRequest: { ...pullRequest, mergeable: false } },
}

/** GitHub is still computing mergeability, so it is rendered as absent rather than as a conflict. */
export const MergeabilityUnknown: Story = {
	args: { pullRequest: { ...pullRequest, mergeable: null, reviewDecision: 'APPROVED' } },
}

export const Merged: Story = {
	args: { pullRequest: { ...pullRequest, state: 'merged', reviewDecision: 'APPROVED' } },
}

export const Closed: Story = {
	args: { pullRequest: { ...pullRequest, state: 'closed' } },
}

/** The branch has a diff but nothing has been opened from it yet. */
export const NoPullRequest: Story = {
	args: { pullRequest: null },
}

/** The subscription dropped. The block keeps every value it had and adds the time it was last current. */
export const Disconnected: Story = {
	args: { staleSince: 1_700_000_000_000 },
}

/** The 200px floor, where every line must truncate rather than reflow. */
export const AtMinimumWidth: Story = {
	decorators: [
		(Story) => (
			<div className="w-[200px] border border-border/60 p-2">
				<Story />
			</div>
		),
	],
}

export const AllStates: Story = {
	decorators: [(Story) => <Story />],
	render: () => (
		<div className="flex flex-wrap items-start gap-4">
			{(
				[
					['Draft', { ...pullRequest, isDraft: true, reviewDecision: null }],
					['Ready', pullRequest],
					['Approved', { ...pullRequest, reviewDecision: 'APPROVED' }],
					['Changes requested', { ...pullRequest, reviewDecision: 'CHANGES_REQUESTED' }],
					['Conflicting', { ...pullRequest, mergeable: false }],
					['Merged', { ...pullRequest, state: 'merged' }],
					['Closed', { ...pullRequest, state: 'closed' }],
					['No pull request', null],
				] satisfies [string, PullRequestRowType | null][]
			).map(([label, row]) => (
				<div key={label} className="w-[352px] border border-border/60 p-2">
					<div className="px-1 pb-1 font-mono text-xs uppercase tracking-wide text-muted-foreground">
						{label}
					</div>
					<PullRequestStatusBlock pullRequest={row} branch={pullRequest.headRef} />
				</div>
			))}
		</div>
	),
}
