import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, screen, userEvent, within } from 'storybook/test'

import { draftSessionStorageKeys } from '../../lib/draft-session-storage-keys'

import { ArtifactCommentThread } from './ArtifactCommentThread'

const meta = {
	title: 'Components/ArtifactViewerV2/ArtifactCommentThread',
	component: ArtifactCommentThread,
	decorators: [
		(Story) => (
			<div style={{ width: '18rem' }}>
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof ArtifactCommentThread>
export default meta

type Story = StoryObj<typeof meta>

// Humans author all V2 root comments (agent identity first appears on replies
// in a later slice), so every fixture here is a human-authored root.
const baseArgs = {
	authorName: 'Dana Reviewer',
	authorAvatarUrl: null,
	createdAt: BigInt(Date.now() - 4 * 60_000),
	contentText: 'This section needs a link to the sync design doc.',
	kind: 'comment' as const,
	active: false,
	outdated: false,
	onActivate: fn(),
	onHoverChange: fn(),
}

const ownedArgs = {
	...baseArgs,
	commentId: 'root-owned',
	contentJson: { type: 'doc', content: [{ type: 'paragraph' }] },
	onEditComment: fn(async () => ({ success: true })),
}

export const HumanRoot: Story = {
	args: baseArgs,
}

export const OwnedMenu: Story = {
	args: ownedArgs,
}

export const NonOwner: Story = {
	args: baseArgs,
}

export const EditInProgress: Story = {
	args: ownedArgs,
	render: (args) => {
		sessionStorage.setItem(draftSessionStorageKeys.edit('root-owned'), JSON.stringify('Unfinished root edit'))
		return <ArtifactCommentThread {...args} />
	},
}

export const Editing: Story = {
	args: ownedArgs,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		await userEvent.click(canvas.getByRole('button', { name: 'Comment actions' }))
		await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit' }))
		await expect(canvas.getByRole('textbox', { name: 'Edit comment' })).toBeVisible()
	},
}

export const EditPending: Story = {
	args: { ...ownedArgs, onEditComment: fn(() => new Promise(() => {})) },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		await userEvent.click(canvas.getByRole('button', { name: 'Comment actions' }))
		await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit' }))
		await userEvent.type(canvas.getByRole('textbox', { name: 'Edit comment' }), ' pending')
		await userEvent.click(canvas.getByRole('button', { name: 'Save' }))
		await expect(canvas.getByRole('button', { name: 'Saving' })).toBeDisabled()
	},
}

export const EditError: Story = {
	args: { ...ownedArgs, onEditComment: fn(async () => Promise.reject(new Error('sync failed'))) },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		await userEvent.click(canvas.getByRole('button', { name: 'Comment actions' }))
		await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit' }))
		await userEvent.type(canvas.getByRole('textbox', { name: 'Edit comment' }), ' retry')
		await userEvent.click(canvas.getByRole('button', { name: 'Save' }))
		await expect(canvas.findByRole('alert')).resolves.toHaveTextContent('Failed to save edit. Try again.')
	},
}

export const NarrowOwned: Story = {
	args: ownedArgs,
	decorators: [
		(Story) => (
			<div style={{ width: '12rem' }}>
				<Story />
			</div>
		),
	],
}

export const LongContent: Story = {
	args: {
		...baseArgs,
		contentText: [
			'The recovery flow described here only covers the happy path.',
			'',
			'What happens when the daemon reconnects mid-transaction? We should either document the reconciliation order explicitly or link to the section that does — otherwise reviewers keep re-deriving it from the code.',
		].join('\n'),
	},
}

export const Active: Story = {
	args: {
		...baseArgs,
		active: true,
	},
}

export const Outdated: Story = {
	args: {
		...baseArgs,
		outdated: true,
		contentText: 'The quoted paragraph was rewritten after this comment.',
	},
}

export const DeletionVerdict: Story = {
	args: {
		...baseArgs,
		kind: 'deletion',
		contentText: 'Delete this',
	},
}

export const ApprovalVerdict: Story = {
	args: {
		...baseArgs,
		kind: 'approval',
		contentText: 'Looks good',
	},
}
