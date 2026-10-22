import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, screen, userEvent, within } from 'storybook/test'

import { draftSessionStorageKeys } from '../../lib/draft-session-storage-keys'

import { ArtifactCommentReply } from './ArtifactCommentReply'

const meta = {
	title: 'Components/ArtifactViewerV2/ArtifactCommentReply',
	component: ArtifactCommentReply,
	decorators: [
		(Story) => (
			<div style={{ width: '18rem' }}>
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof ArtifactCommentReply>
export default meta

type Story = StoryObj<typeof meta>

const baseArgs = {
	authorName: 'Dana Reviewer',
	authorAvatarUrl: null,
	createdAt: BigInt(Date.now() - 2 * 60_000),
	contentText: 'Agreed — I will link the sync design doc here.',
	createdByAgent: false,
	active: false,
	onActivate: fn(),
	onHoverChange: fn(),
}

const ownedArgs = {
	...baseArgs,
	commentId: 'reply-owned',
	contentJson: { type: 'doc', content: [{ type: 'paragraph' }] },
	onEditComment: fn(async () => ({ success: true })),
}

export const HumanReply: Story = {
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
		sessionStorage.setItem(draftSessionStorageKeys.edit('reply-owned'), JSON.stringify('Unfinished reply edit'))
		return <ArtifactCommentReply {...args} />
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

export const AgentReply: Story = {
	args: {
		...baseArgs,
		authorName: 'Agent',
		createdByAgent: true,
		contentText: 'Removed the stale section and added the reconciliation-order note you asked for.',
	},
}

export const LongContent: Story = {
	args: {
		...baseArgs,
		contentText: [
			'The daemon reconnect path is documented now.',
			'',
			'I split it into three cases: clean reconnect, mid-transaction reconnect, and hard failure — each links to the relevant recovery routine so reviewers no longer re-derive it.',
		].join('\n'),
	},
}

export const Active: Story = {
	args: {
		...baseArgs,
		active: true,
	},
}
