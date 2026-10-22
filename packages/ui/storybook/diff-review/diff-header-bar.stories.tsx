import type { Meta, StoryObj } from '@storybook/react'
import { fn } from 'storybook/test'

import { DiffHeaderBar } from '../../src/components/diff-review/diff-header-bar'

const meta = {
	title: 'Components/Diff Review/Diff Header Bar',
	component: DiffHeaderBar,
	parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof DiffHeaderBar>

export default meta
type Story = StoryObj<typeof meta>

export const Unified: Story = {
	args: {
		diffStyle: 'unified',
		onDiffStyleChange: fn(),
		reviewedCount: 3,
		totalCount: 5,
		collapsedCount: 2,
		reviewedLines: 63,
		totalLines: 138,
		hideReviewed: false,
		onHideReviewedChange: fn(),
		comparison: 'since-last-review',
		onComparisonChange: fn(),
		reviewActions: {
			markAllReviewed: fn(),
			markAllUnreviewed: fn(),
			collapseAll: fn(),
			expandAll: fn(),
			resetReview: fn(),
		},
		onCopyReviewLink: fn(),
		onClose: fn(),
		onFullscreenToggle: fn(),
	},
}

export const Split: Story = {
	args: { ...Unified.args, diffStyle: 'split' },
}

export const SinceTaskStart: Story = {
	args: { ...Unified.args, comparison: 'since-task-start' },
}

/** The header in a sidebar-width container, where the action group wraps. */
export const Narrow: Story = {
	args: Unified.args,
	decorators: [
		(Story) => (
			<div style={{ width: 340 }}>
				<Story />
			</div>
		),
	],
}

export const NoneReviewed: Story = {
	args: { ...Unified.args, reviewedCount: 0, collapsedCount: 0, reviewedLines: 0 },
}

export const AllReviewed: Story = {
	args: { ...Unified.args, reviewedCount: 5, collapsedCount: 5, reviewedLines: 138 },
}
