import type { Meta, StoryObj } from '@storybook/react'

import { DiffFileTree } from '../../src/components/diff-review/DiffFileTree'
import { diffReviewFiles } from './fixtures'

const meta = {
	title: 'Components/DiffReview/DiffFileTree',
	component: DiffFileTree,
	parameters: { layout: 'centered' },
	decorators: [
		(Story) => (
			<div className="h-[420px] w-80 border border-border">
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof DiffFileTree>

export default meta
type Story = StoryObj<typeof meta>

export const MultiRepo: Story = {
	args: {
		files: diffReviewFiles.map((file) => ({ path: file.path, status: file.status })),
		onSelectFile: (path) => console.log('selected file:', path),
	},
}

export const SingleRepo: Story = {
	args: {
		files: diffReviewFiles
			.filter((file) => file.path.startsWith('riptide-api/'))
			.map((file) => ({ path: file.path, status: file.status })),
	},
}

/** Two distinct diff records can map to the same displayed path after a repository ID changes. */
export const DuplicatePath: Story = {
	args: {
		files: [
			{
				path: 'syncopate/apps/riptide-api/src/orpc/api/auth/admin/organizations-settings-set.effect.ts',
				status: 'modified',
			},
			{
				path: 'syncopate/apps/riptide-api/src/orpc/api/auth/admin/organizations-settings-set.effect.ts',
				status: 'added',
			},
		],
	},
}

export const Empty: Story = { args: { files: [], status: 'ready' } }

export const Loading: Story = { args: { files: [], status: 'loading' } }

export const Unavailable: Story = { args: { files: [], status: 'unavailable' } }
