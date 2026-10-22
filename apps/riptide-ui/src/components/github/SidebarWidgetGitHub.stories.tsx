import type { CheckRowType, PullRequestRowType } from '@humanlayer/streams/pr-status'
import type { Meta, StoryObj } from '@storybook/react-vite'

import { SidebarWidgetGitHub } from './SidebarWidgetGitHub'

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

const check = (overrides: Partial<CheckRowType>): CheckRowType => ({
	id: overrides.name ?? 'check',
	name: 'typecheck',
	headSha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
	status: 'COMPLETED',
	conclusion: 'SUCCESS',
	detailsUrl: 'https://github.com/humanlayer/syncopate/actions/runs/1/job/2',
	startedAt: '2026-08-30T09:00:00Z',
	completedAt: '2026-08-30T09:01:12Z',
	...overrides,
})

const checks: CheckRowType[] = [
	check({ name: 'typecheck', conclusion: 'FAILURE' }),
	check({ name: 'test / riptide-api', conclusion: 'FAILURE' }),
	check({ name: 'build / native', status: 'IN_PROGRESS', conclusion: null, completedAt: null }),
	check({ name: 'lint' }),
	check({ name: 'quality' }),
]

/** Fixed so a running check renders the same elapsed time in every snapshot. */

const meta = {
	title: 'Components/GitHub/SidebarWidgetGitHub',
	component: SidebarWidgetGitHub,
	parameters: { layout: 'padded' },
	decorators: [
		(Story) => (
			<div className="h-[560px] w-[352px] border border-border/60 p-2">
				<Story />
			</div>
		),
	],
	args: { pullRequest, branch: pullRequest.headRef, checks },
} satisfies Meta<typeof SidebarWidgetGitHub>

export default meta
type Story = StoryObj<typeof meta>

export const WithPullRequest: Story = {}

/** Before a pull request exists. The tab is still present — the branch has work on it. */
export const BeforePullRequest: Story = {
	args: { pullRequest: null, checks: [] },
}

/** A repository with no CI. The checks block is absent rather than reporting a zero. */
export const WithoutChecks: Story = {
	args: { checks: [] },
}

/** The stream gave up. The section stays and names the branch it could not answer for. */
export const StatusUnavailable: Story = {
	args: { pullRequest: null, checks: [], state: 'unavailable' },
}

/** Drawn from the record alone: the notice says it is out of date, so the gaps read as gaps. */
export const FromTheRecordAlone: Story = {
	args: { checks: [], state: 'recorded' },
}

/** Nobody has reviewed yet, so the panel is status and checks alone. */
export const WithoutReview: Story = {
	args: {
		pullRequest: {
			...pullRequest,
			reviewDecision: 'REVIEW_REQUIRED',
			unresolvedThreadCount: 0,
			resolvedThreadCount: 0,
			changesRequestedReviews: [],
		},
	},
}
