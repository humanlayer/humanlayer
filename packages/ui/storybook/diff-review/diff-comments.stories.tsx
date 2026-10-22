import type { Meta, StoryObj } from '@storybook/react'

import { DiffCommentFileSection } from '../../src/components/diff-review/diff-comment-file-section'
import { DiffCommentThread } from '../../src/components/diff-review/diff-comment-thread'
import {
	currentDiffCommentThread,
	deletedDiffCommentThread,
	missingDiffCommentThread,
	outdatedDiffCommentThread,
	renamedDiffCommentThread,
	resolvedDiffCommentThread,
} from './fixtures'

const meta = {
	title: 'Components/Diff Review/Diff Comments',
	component: DiffCommentThread,
	decorators: [(Story) => <div className="mx-auto max-w-2xl py-8"><Story /></div>],
} satisfies Meta<typeof DiffCommentThread>

export default meta
type Story = StoryObj<typeof meta>

export const CurrentWithAgentReply: Story = { args: { thread: currentDiffCommentThread } }
// Split view's half-width column: the name truncates and the actions wrap as
// whole controls, with the delivery action reduced to an icon.
export const Narrow: Story = {
	args: {
		thread: currentDiffCommentThread,
		taskId: currentDiffCommentThread.root.task_id,
		onReply: async () => true,
		onResolve: () => {},
		onDeliver: () => {},
		onCopyLink: () => {},
	},
	decorators: [(Story) => <div className="w-56"><Story /></div>],
}
export const Resolved: Story = { args: { thread: resolvedDiffCommentThread } }
export const DeletedRootTombstone: Story = { args: { thread: deletedDiffCommentThread } }
export const OutdatedInlineAfterRename: Story = { args: { thread: renamedDiffCommentThread } }

export const OutdatedFileSection: Story = {
	args: { thread: outdatedDiffCommentThread },
	render: () => <DiffCommentFileSection threads={[outdatedDiffCommentThread]} />,
}

export const MissingFileSection: Story = {
	args: { thread: missingDiffCommentThread },
	render: () => (
		<DiffCommentFileSection
			repoId="syncopate"
			path="riptide-api/src/removed.ts"
			threads={[missingDiffCommentThread]}
			missing
		/>
	),
}
