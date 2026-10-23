import type { Meta, StoryObj } from '@storybook/react'
import { fn } from 'storybook/test'

import { ArtifactOutline } from './ArtifactOutline'
import type { CountedOutlineItem } from './comment-counts'

const meta = {
	title: 'Components/ArtifactViewerV2/ArtifactOutline',
	component: ArtifactOutline,
	decorators: [
		(Story) => (
			<div style={{ height: '24rem', display: 'flex' }}>
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof ArtifactOutline>
export default meta

type Story = StoryObj<typeof meta>

const item = (
	id: string,
	level: 1 | 2 | 3,
	text: string,
	pos: number,
	commentCount = 0,
	children: CountedOutlineItem[] = [],
): CountedOutlineItem => ({ id, level, text, pos, commentCount, children })

const nestedItems: CountedOutlineItem[] = [
	item('h1-research-artifact-viewer', 1, 'Research: Artifact Viewer', 0, 0, [
		item('h2-summary', 2, 'Summary', 12, 1),
		item('h2-detailed-findings', 2, 'Detailed Findings', 40, 0, [
			item('h3-selection-plumbing', 3, 'Selection plumbing', 60, 4),
			item(
				'h3-a-very-long-heading',
				3,
				'A very long heading title that should truncate instead of wrapping the outline row onto multiple lines',
				90,
				18,
			),
		]),
		item('h2-open-questions', 2, 'Open Questions', 120, 0),
	]),
	item('h1-appendix', 1, 'Appendix', 150, 2, [
		item('h2-open-questions-2', 2, 'Open Questions', 170, 1),
	]),
]

export const NestedHeadings: Story = {
	args: {
		items: nestedItems,
		activeItemId: null,
		onItemClick: fn(),
	},
}

export const ActiveRow: Story = {
	args: {
		items: nestedItems,
		activeItemId: 'h3-selection-plumbing',
		onItemClick: fn(),
	},
}

/** Scroll tracking at the document top: the first outline item is active. */
export const ActiveFirstSection: Story = {
	args: {
		items: nestedItems,
		activeItemId: 'h1-research-artifact-viewer',
		onItemClick: fn(),
	},
}

/** Scroll tracking at the document bottom: the final section stays active. */
export const ActiveLastSection: Story = {
	args: {
		items: nestedItems,
		activeItemId: 'h2-open-questions-2',
		onItemClick: fn(),
	},
}

export const Empty: Story = {
	args: {
		items: [],
		activeItemId: null,
		onItemClick: fn(),
	},
}

export const ZeroCounts: Story = {
	args: {
		items: [item('h1-overview', 1, 'Overview', 0, 0), item('h1-details', 1, 'Details', 20, 0)],
		activeItemId: null,
		onItemClick: fn(),
	},
}

export const SingleAndManyCounts: Story = {
	args: {
		items: nestedItems,
		activeItemId: 'h3-a-very-long-heading',
		onItemClick: fn(),
	},
}

export const CompactCounts: Story = {
	decorators: [
		(Story) => (
			<div style={{ width: '11rem', height: '18rem' }}>
				<Story />
			</div>
		),
	],
	args: {
		items: nestedItems,
		activeItemId: null,
		onItemClick: fn(),
	},
}
