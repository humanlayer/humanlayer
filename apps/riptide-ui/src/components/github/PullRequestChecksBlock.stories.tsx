import type { CheckRowType } from '@humanlayer/streams/pr-status'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import { type CheckDeliveryControls, PullRequestChecksBlock } from './PullRequestChecksBlock'

/** Fixed so a running check's elapsed time is the same pixel every render. */

const check = (overrides: Partial<CheckRowType>): CheckRowType => ({
	id: overrides.name ?? 'check',
	name: 'typecheck',
	status: 'COMPLETED',
	conclusion: 'SUCCESS',
	detailsUrl: 'https://github.com/humanlayer/syncopate/actions/runs/1/job/2',
	startedAt: '2026-08-30T09:00:00Z',
	completedAt: '2026-08-30T09:01:12Z',
	...overrides,
})

const PASSING = ['lint', 'quality', 'e2e', 'migrate', 'docs', 'bundle', 'storybook', 'licence'].map((name) =>
	check({ name }),
)

const RED: CheckRowType[] = [
	check({ name: 'typecheck', conclusion: 'FAILURE' }),
	check({ name: 'test / riptide-api', conclusion: 'FAILURE', completedAt: '2026-08-30T09:03:48Z' }),
	check({ name: 'Socket Security', conclusion: 'FAILURE' }),
	check({ name: 'build / native', status: 'IN_PROGRESS', conclusion: null, completedAt: null }),
	...PASSING,
]

const meta = {
	title: 'Components/GitHub/PullRequestChecksBlock',
	component: PullRequestChecksBlock,
	parameters: { layout: 'padded' },
	// The panel is resizable from a 200px floor to 60% of the content area. The default frame is
	// the prototype's 352px.
	decorators: [
		(Story) => (
			<div className="w-[352px] border border-border/60 p-2">
				<Story />
			</div>
		),
	],
	args: { checks: RED },
} satisfies Meta<typeof PullRequestChecksBlock>

export default meta
type Story = StoryObj<typeof meta>

export const Red: Story = {}

export const Green: Story = {
	args: { checks: PASSING },
}

export const Running: Story = {
	args: {
		checks: [
			check({ name: 'build / native', status: 'IN_PROGRESS', conclusion: null, completedAt: null }),
			check({ name: 'test / riptide-api', status: 'QUEUED', conclusion: null, startedAt: null, completedAt: null }),
			...PASSING.slice(0, 3),
		],
	},
}

/** Cancelled, timed out and stale all block the merge, so all three read as failures. */
export const NonObviousFailures: Story = {
	args: {
		checks: [
			check({ name: 'test / riptide-api', conclusion: 'CANCELLED' }),
			check({ name: 'build / native', conclusion: 'TIMED_OUT' }),
			check({ name: 'deploy preview', conclusion: 'STALE' }),
			check({ name: 'licence scan', conclusion: 'ACTION_REQUIRED' }),
			check({ name: 'changelog', conclusion: 'SKIPPED' }),
			check({ name: 'lint', conclusion: 'NEUTRAL' }),
		],
	},
}

/** The 200px floor, where every name truncates rather than reflowing. */
export const AtMinimumWidth: Story = {
	decorators: [
		(Story) => (
			<div className="w-[200px] border border-border/60 p-2">
				<Story />
			</div>
		),
	],
}

/** Nothing at all: a repository with no CI has no rollup to report. */
export const NoChecks: Story = {
	args: { checks: [] },
}

export const AllStates: Story = {
	decorators: [(Story) => <Story />],
	render: () => (
		<div className="flex flex-wrap items-start gap-4">
			{(
				[
					['Red', RED],
					['Green', PASSING],
					['Running', [check({ name: 'build', status: 'IN_PROGRESS', conclusion: null, completedAt: null })]],
					['No checks', []],
				] satisfies [string, CheckRowType[]][]
			).map(([label, checks]) => (
				<div key={label} className="w-[352px] border border-border/60 p-2">
					<div className="px-1 pb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
						{label}
					</div>
					<PullRequestChecksBlock checks={checks} />
				</div>
			))}
		</div>
	),
}

const delivery = (overrides: Partial<CheckDeliveryControls> = {}): CheckDeliveryControls => ({
	kind: 'send',
	pending: false,
	pendingSelection: undefined,
	error: null,
	sendChecks: fn(),
	...overrides,
})

/** On a session page: every failing row and the rollup can hand the failure to the agent. */
export const WithSendToAgent: Story = {
	args: { delivery: delivery() },
}

/** The agent is mid-run, so a send queues; the label does not change, the toast says which happened. */
export const SendingAllFailing: Story = {
	args: { delivery: delivery({ kind: 'queue', pending: true, pendingSelection: null }) },
}

/** No agent can take the prompt right now: the same controls copy it instead. */
export const CopyPrompt: Story = {
	args: { delivery: delivery({ kind: 'copy' }) },
}

/** A failed send reads inline under the rollup, never as a toast. */
export const SendFailed: Story = {
	args: { delivery: delivery({ error: 'Check details could not be fetched from GitHub.' }) },
}
