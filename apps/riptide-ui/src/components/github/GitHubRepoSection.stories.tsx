import type { CheckRowType, PullRequestRowType } from '@humanlayer/streams/pr-status'
import type { Meta, StoryObj } from '@storybook/react-vite'

import { GitHubOtherBranchesDivider } from './GitHubOtherBranchesDivider'
import { GitHubRepoSection } from './GitHubRepoSection'
import { SidebarWidgetGitHub } from './SidebarWidgetGitHub'

const pullRequest = (overrides: Partial<PullRequestRowType>): PullRequestRowType => ({
	id: 'humanlayer/syncopate:feat/metrics-cost',
	number: 2455,
	title: 'Add cost columns to the metrics API',
	url: 'https://github.com/humanlayer/syncopate/pull/2455',
	state: 'open',
	isDraft: false,
	headRef: 'feat/metrics-cost',
	baseRef: 'main',
	headSha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
	mergeable: true,
	reviewDecision: 'REVIEW_REQUIRED',
	...overrides,
})

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

const appChecks: CheckRowType[] = [
	check({ name: 'test-services', conclusion: 'FAILURE' }),
	check({ name: 'typecheck' }),
	check({ name: 'quality' }),
]

const sdkChecks: CheckRowType[] = [check({ name: 'build' }), check({ name: 'test' })]

const meta = {
	title: 'Components/GitHub/GitHubRepoSection',
	component: GitHubRepoSection,
	parameters: { layout: 'padded' },
	decorators: [
		(Story) => (
			<div className="flex w-[352px] flex-col gap-2 border border-border/60 p-2">
				<Story />
			</div>
		),
	],
	args: {
		name: 'humanlayer/syncopate',
		branch: 'feat/metrics-cost',
		failingCheckCount: 1,
		pullRequest: pullRequest({}),
		children: (
			<SidebarWidgetGitHub
				pullRequest={pullRequest({})}
				branch="feat/metrics-cost"
				checks={appChecks}
				hasPullRequest
			/>
		),
	},
} satisfies Meta<typeof GitHubRepoSection>

export default meta
type Story = StoryObj<typeof meta>

export const Open: Story = {}

export const Shut: Story = {
	args: { defaultOpen: false },
}

/** The branch the session is checked out on: lit, and the one the tab opens by default. */
export const Current: Story = {
	args: { isCurrent: true },
}

/** A task's two branches seen from a session on the first: only that one is lit and open. */
export const TwoRepositories: Story = {
	render: (args) => (
		<>
			<GitHubRepoSection {...args} isCurrent />
			<GitHubRepoSection
				name="humanlayer/agentlayer"
				branch="feat/metrics-cost"
				failingCheckCount={0}
				pullRequest={{ state: 'open', isDraft: true }}
				defaultOpen={false}
			>
				<SidebarWidgetGitHub
					pullRequest={pullRequest({
						id: 'humanlayer/agentlayer:feat/metrics-cost',
						number: 812,
						title: 'Emit cache token counts per turn',
						url: 'https://github.com/humanlayer/agentlayer/pull/812',
						isDraft: true,
						reviewDecision: null,
					})}
					branch="feat/metrics-cost"
					checks={sdkChecks}
					hasPullRequest
				/>
			</GitHubRepoSection>
		</>
	),
}

/**
 * A session whose workspace holds two checkouts, seen against a task with one more branch: both
 * current sections are lit and open, and the divider names the rest.
 */
export const TwoCheckoutsAndAnotherTaskBranch: Story = {
	render: () => (
		<>
			<GitHubRepoSection
				name="humanlayer/agentlayer"
				branch="replace-taskworkspace-system-with-projects-abstraction"
				isCurrent
				failingCheckCount={0}
			>
				<SidebarWidgetGitHub
					pullRequest={null}
					branch="replace-taskworkspace-system-with-projects-abstraction"
					checks={[]}
					hasPullRequest={false}
				/>
			</GitHubRepoSection>
			<GitHubRepoSection
				name="humanlayer/syncopate"
				branch="phase-5-runnable-project-sessions"
				isCurrent
				failingCheckCount={1}
			>
				<SidebarWidgetGitHub
					pullRequest={pullRequest({
						id: 'humanlayer/syncopate:phase-5-runnable-project-sessions',
						number: 2465,
						title: 'Add runnable project workspace sessions',
						url: 'https://github.com/humanlayer/syncopate/pull/2465',
						headRef: 'phase-5-runnable-project-sessions',
					})}
					branch="phase-5-runnable-project-sessions"
					checks={appChecks}
					hasPullRequest
				/>
			</GitHubRepoSection>
			<GitHubOtherBranchesDivider count={1} />
			<GitHubRepoSection
				name="humanlayer/syncopate"
				branch="replace-taskworkspace-system-with-projects-abstraction"
				failingCheckCount={0}
				pullRequest={{ state: 'merged', isDraft: false }}
				defaultOpen={false}
			>
				<SidebarWidgetGitHub
					pullRequest={pullRequest({
						id: 'humanlayer/syncopate:replace-taskworkspace-system-with-projects-abstraction',
						number: 2425,
						title: 'Replace the task workspace system with a projects abstraction',
						url: 'https://github.com/humanlayer/syncopate/pull/2425',
						state: 'merged',
						headRef: 'replace-taskworkspace-system-with-projects-abstraction',
					})}
					branch="replace-taskworkspace-system-with-projects-abstraction"
					checks={[]}
					hasPullRequest
				/>
			</GitHubRepoSection>
		</>
	),
}

/** Every lifecycle a shut header can name, with the pill read from the recorded pull request. */
export const ShutLifecycles: Story = {
	render: () => (
		<>
			{(
				[
					['draft', { state: 'open', isDraft: true }],
					['ready', { state: 'open', isDraft: false }],
					['merged', { state: 'merged', isDraft: false }],
					['closed', { state: 'closed', isDraft: false }],
				] as const
			).map(([lifecycle, state]) => (
				<GitHubRepoSection
					key={lifecycle}
					name="humanlayer/syncopate"
					branch={`feat/${lifecycle}-branch`}
					failingCheckCount={0}
					pullRequest={state}
					defaultOpen={false}
				>
					<SidebarWidgetGitHub
						pullRequest={pullRequest({ ...state, headRef: `feat/${lifecycle}-branch` })}
						branch={`feat/${lifecycle}-branch`}
						checks={[]}
						hasPullRequest
					/>
				</GitHubRepoSection>
			))}
		</>
	),
}
