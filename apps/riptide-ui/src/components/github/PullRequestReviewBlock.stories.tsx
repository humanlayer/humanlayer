import type { PullRequestRowType } from '@humanlayer/streams/pr-status'
import type { Meta, StoryObj } from '@storybook/react-vite'

import { PullRequestReviewBlock } from './PullRequestReviewBlock'

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
	reviewDecision: 'CHANGES_REQUESTED',
	unresolvedThreadCount: 3,
	resolvedThreadCount: 37,
	changesRequestedReviews: [
		{
			login: 'K-Mistele',
			body: 'Move the parsing into the github service and delete the wrapper. HttpClient should be a layer requirement, not a parameter.',
			submittedAt: '2026-09-01T10:00:00Z',
			url: 'https://github.com/humanlayer/syncopate/pull/2261#pullrequestreview-1',
		},
	],
}

const meta = {
	title: 'Components/GitHub/PullRequestReviewBlock',
	component: PullRequestReviewBlock,
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
	args: { pullRequest },
} satisfies Meta<typeof PullRequestReviewBlock>

export default meta
type Story = StoryObj<typeof meta>

export const ChangesRequested: Story = {}

/** Threads open under a review that has not decided anything yet: the block is work, not an objection. */
export const OpenThreadsOnly: Story = {
	args: {
		pullRequest: { ...pullRequest, reviewDecision: 'REVIEW_REQUIRED', changesRequestedReviews: [] },
	},
}

/** A review that asked for changes with no inline thread at all, the one review that never appears as a thread. */
export const ReviewWithoutThreads: Story = {
	args: { pullRequest: { ...pullRequest, unresolvedThreadCount: 0, resolvedThreadCount: 0 } },
}

/** Two reviewers standing on changes: one line each, whatever the review's length. */
export const TwoReviewers: Story = {
	args: {
		pullRequest: {
			...pullRequest,
			changesRequestedReviews: [
				{
					login: 'dexhorthy',
					body: [
						'A few things before this can go in:',
						'',
						'1. the reconciler claims rows inside the transaction but looks them up outside it',
						'2. the 30-day window ages a long-lived session out of attribution',
						'3. please split the persistence change out; it is reviewable on its own',
					].join('\n'),
					submittedAt: '2026-09-02T09:00:00Z',
					url: 'https://github.com/humanlayer/syncopate/pull/2261#pullrequestreview-2',
				},
				...(pullRequest.changesRequestedReviews ?? []),
			],
		},
	},
}

export const AtFloorWidth: Story = {
	decorators: [
		(Story) => (
			<div className="w-[200px] border border-border/60 p-2">
				<Story />
			</div>
		),
	],
}
