import type { CheckRowType, PullRequestMergeStateType, PullRequestRowType } from '@humanlayer/streams/pr-status'
import type { Meta, StoryObj } from '@storybook/react-vite'

import { PullRequestMergeRow } from './PullRequestMergeRow'

const HEAD_SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'

const pullRequest: PullRequestRowType = {
	id: 'humanlayer/syncopate:collapse-artifact-button-tray-into-priority-plus',
	number: 2489,
	title: 'Add responsive priority-plus artifact action tray',
	url: 'https://github.com/humanlayer/syncopate/pull/2489',
	state: 'open',
	isDraft: false,
	headRef: 'collapse-artifact-button-tray-into-priority-plus',
	baseRef: 'main',
	headSha: HEAD_SHA,
	mergeable: true,
	reviewDecision: 'APPROVED',
	merge: null,
}

const merge: PullRequestMergeStateType = {
	mergeStateStatus: 'CLEAN',
	autoMergeRequest: null,
	viewerCanEnableAutoMerge: false,
	viewerCanDisableAutoMerge: false,
	viewerCanUpdateBranch: false,
	mergeHeadline: 'Merge pull request #2489 from humanlayer/collapse-artifact-button-tray-into-priority-plus',
	mergeBody: 'Add responsive priority-plus artifact action tray',
	squashHeadline: 'Add responsive priority-plus artifact action tray (#2489)',
	squashBody:
		'* Collapse the tray into a priority-plus menu\n\n* Measure the tray with a ResizeObserver\n\n* Keep the primary action visible at 200px',
	commitCount: 3,
	mergeCommitAllowed: true,
	squashMergeAllowed: true,
	rebaseMergeAllowed: true,
	viewerDefaultMergeMethod: 'MERGE',
}

const check = (name: string, overrides: Partial<CheckRowType> = {}): CheckRowType => ({
	id: `check_run:${name}`,
	name,
	headSha: HEAD_SHA,
	status: 'COMPLETED',
	conclusion: 'SUCCESS',
	detailsUrl: 'https://github.com/humanlayer/syncopate/actions/runs/1/job/2',
	startedAt: '2026-08-30T09:00:00Z',
	completedAt: '2026-08-30T09:01:12Z',
	...overrides,
})

const passing = [check('typecheck'), check('test / riptide-api'), check('quality')]
const failing = [check('typecheck', { conclusion: 'FAILURE' }), check('test / riptide-api'), check('quality')]

const meta = {
	title: 'Components/GitHub/PullRequestMergeRow',
	component: PullRequestMergeRow,
	parameters: { layout: 'padded' },
	decorators: [
		(Story) => (
			<div className="w-[352px] border border-border/60 p-2">
				<Story />
			</div>
		),
	],
	args: {
		pullRequest,
		merge,
		checks: passing,
		method: 'SQUASH',
		onMethodChange: () => {},
		busy: null,
		error: null,
		onMutate: () => {},
	},
} satisfies Meta<typeof PullRequestMergeRow>

export default meta
type Story = StoryObj<typeof meta>

/** Green only here: GitHub would merge and every section passed. */
export const CleanAndApproved: Story = {}

/** GitHub allows the merge, but a check nobody required is failing, so the button stays grey. */
export const Unstable: Story = {
	args: { merge: { ...merge, mergeStateStatus: 'UNSTABLE' }, checks: failing },
}

/** Disabled with GitHub's own reason; fixing the checks is the checks block's job. */
export const Blocked: Story = {
	args: {
		pullRequest: { ...pullRequest, reviewDecision: 'REVIEW_REQUIRED' },
		merge: { ...merge, mergeStateStatus: 'BLOCKED' },
		checks: failing,
	},
}

/** The repository allows auto-merge, so the blocked button turns into the arming one. */
export const AutoMergeAvailable: Story = {
	args: {
		pullRequest: { ...pullRequest, reviewDecision: 'REVIEW_REQUIRED' },
		merge: { ...merge, mergeStateStatus: 'BLOCKED', viewerCanEnableAutoMerge: true },
	},
}

export const AutoMergeArmed: Story = {
	args: {
		pullRequest: { ...pullRequest, reviewDecision: 'REVIEW_REQUIRED' },
		merge: {
			...merge,
			mergeStateStatus: 'BLOCKED',
			autoMergeRequest: { enabledBy: { login: 'pepijn' }, mergeMethod: 'SQUASH' },
			viewerCanDisableAutoMerge: true,
		},
	},
}

/** The base moved on; GitHub lets the App update the branch before merging. */
export const Behind: Story = {
	args: { merge: { ...merge, mergeStateStatus: 'BEHIND', viewerCanUpdateBranch: true } },
}

export const Draft: Story = {
	args: {
		pullRequest: { ...pullRequest, isDraft: true, reviewDecision: null },
		merge: { ...merge, mergeStateStatus: 'DRAFT' },
	},
}

export const Merging: Story = {
	args: { busy: 'merge' },
}

export const Failed: Story = {
	args: { error: 'Head branch was modified. Review and try the merge again.' },
}

/** Merged and closed leave only the lifecycle links, so the button is gone entirely. */
export const Closed: Story = {
	args: { pullRequest: { ...pullRequest, state: 'closed' } },
}

/** The 200px floor, where GitHub's longer labels wrap to a second line. */
export const AtMinimumWidth: Story = {
	args: { merge: { ...merge, mergeStateStatus: 'BLOCKED', viewerCanEnableAutoMerge: true } },
	decorators: [
		(Story) => (
			<div className="w-[200px] border border-border/60 p-2">
				<Story />
			</div>
		),
	],
}
