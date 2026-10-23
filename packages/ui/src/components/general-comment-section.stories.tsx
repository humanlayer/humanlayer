import type { Meta, StoryObj } from '@storybook/react'
import { fn } from 'storybook/test'
import {
	createMockComment,
	mockUsers,
	outdatedComment,
	replyComment,
	resolvedComment,
	spanlessComment,
} from './__stories__/comment-fixtures'
import { GeneralCommentSection } from './general-comment-section'

const userLookup = new Map(
	Object.values(mockUsers).map((u) => [u.userId, { displayName: u.displayName, avatarUrl: u.avatarUrl }]),
)

const meta = {
	title: 'Comments/GeneralCommentSection',
	component: GeneralCommentSection,
	parameters: { layout: 'padded' },
	tags: ['autodocs'],
	args: {
		onReply: fn(),
		onDelete: fn(),
		onResolve: fn(),
		onUnresolve: fn(),
		onCreateComment: fn(),
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
} satisfies Meta<typeof GeneralCommentSection>

export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = {
	args: {
		threads: [],
	},
}

export const SingleComment: Story = {
	args: {
		threads: [{ root: spanlessComment, replies: [] }],
	},
}

export const MixedSpanlessAndOutdated: Story = {
	args: {
		threads: [
			{ root: spanlessComment, replies: [replyComment] },
			{ root: outdatedComment, replies: [] },
			{
				root: createMockComment({
					content_text: 'Is this still needed given the latest changes?',
					created_by_user_id: 'user_abc2',
				}),
				replies: [],
			},
		],
	},
}

export const WithResolvedComments: Story = {
	args: {
		threads: [
			{ root: spanlessComment, replies: [replyComment] },
			{ root: resolvedComment, replies: [] },
			{
				root: createMockComment({
					is_resolved: true,
					resolved_by_user_id: 'user_abc1',
					content_text: 'Fixed in the latest commit.',
				}),
				replies: [],
			},
		],
	},
}

export const AllResolved: Story = {
	args: {
		threads: [
			{ root: resolvedComment, replies: [] },
			{
				root: createMockComment({
					is_resolved: true,
					resolved_by_user_id: 'user_abc2',
					content_text: 'No longer relevant after refactor.',
					created_by_user_id: 'user_abc2',
				}),
				replies: [],
			},
		],
	},
}
