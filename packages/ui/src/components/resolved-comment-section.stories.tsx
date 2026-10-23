import type { Meta, StoryObj } from '@storybook/react'
import { fn } from 'storybook/test'
import { createMockComment, mockUsers, replyComment, resolvedComment } from './__stories__/comment-fixtures'
import { ResolvedCommentSection } from './resolved-comment-section'

const userLookup = new Map(
	Object.values(mockUsers).map((u) => [u.userId, { displayName: u.displayName, avatarUrl: u.avatarUrl }]),
)

const meta = {
	title: 'Comments/ResolvedCommentSection',
	component: ResolvedCommentSection,
	parameters: { layout: 'padded' },
	tags: ['autodocs'],
	args: {
		onReply: fn(),
		onDelete: fn(),
		onUnresolve: fn(),
		currentUserId: 'user_abc1',
		userLookup,
	},
	decorators: [
		(Story) => (
			<div className="w-96">
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof ResolvedCommentSection>

export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = {
	args: {
		threads: [],
	},
}

export const Default: Story = {
	args: {
		threads: [
			{ root: resolvedComment, replies: [] },
			{
				root: createMockComment({
					is_resolved: true,
					resolved_by_user_id: 'user_abc1',
					content_text: 'Fixed in the latest commit.',
				}),
				replies: [],
			},
			{
				root: createMockComment({
					is_resolved: true,
					resolved_by_user_id: 'user_abc2',
					content_text: 'Agreed, no longer relevant.',
					created_by_user_id: 'user_abc2',
				}),
				replies: [],
			},
		],
	},
}

// Demonstrates a single thread with replies — click any row's chevron to expand
export const WithReplies: Story = {
	args: {
		threads: [
			{ root: resolvedComment, replies: [replyComment] },
			{
				root: createMockComment({
					is_resolved: true,
					resolved_by_user_id: 'user_abc1',
					content_text: 'This was addressed in PR #42.',
				}),
				replies: [],
			},
		],
	},
}
