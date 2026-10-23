import type { Meta, StoryObj } from '@storybook/react'
import { fn } from 'storybook/test'
import {
	agentCreatedComment,
	agentReplyComment,
	createMockComment,
	inlineComment,
	mockUsers,
	outdatedComment,
	replyComment,
	resolvedComment,
} from './__stories__/comment-fixtures'
import { CommentThread } from './comment-thread'

const userLookup = new Map(
	Object.values(mockUsers).map((u) => [u.userId, { displayName: u.displayName, avatarUrl: u.avatarUrl }]),
)

const meta = {
	title: 'Comments/CommentThread',
	component: CommentThread,
	parameters: { layout: 'centered' },
	tags: ['autodocs'],
	args: {
		onReply: fn(),
		onDelete: fn(),
		onResolve: fn(),
		currentUserId: 'user_abc1',
		replies: [],
		userLookup,
	},
	decorators: [
		(Story) => (
			<div className="w-80">
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof CommentThread>

export default meta
type Story = StoryObj<typeof meta>

export const SingleComment: Story = {
	args: {
		rootComment: inlineComment,
		replies: [],
	},
}

export const WithReplies: Story = {
	args: {
		rootComment: inlineComment,
		replies: [
			replyComment,
			createMockComment({
				reply_to_comment_id: inlineComment.id,
				created_by_user_id: 'user_abc3',
				content_text: 'I reviewed it too, looks great.',
				created_at: BigInt(Date.now() - 60_000),
				updated_at: BigInt(Date.now() - 60_000),
			}),
		],
	},
}

export const ResolvedThread: Story = {
	args: {
		rootComment: resolvedComment,
		replies: [replyComment],
	},
}

export const OutdatedRoot: Story = {
	args: {
		rootComment: outdatedComment,
		replies: [],
	},
}

const manyReplies = Array.from({ length: 12 }, (_, i) =>
	createMockComment({
		reply_to_comment_id: inlineComment.id,
		created_by_user_id: ['user_abc1', 'user_abc2', 'user_abc3'][i % 3],
		content_text: `Reply #${i + 1} — this is part of a long conversation thread.`,
		created_at: BigInt(Date.now() - (12 - i) * 60_000),
		updated_at: BigInt(Date.now() - (12 - i) * 60_000),
	}),
)

export const ManyRepliesCollapsed: Story = {
	args: {
		rootComment: inlineComment,
		replies: manyReplies,
	},
}

export const LongComment: Story = {
	args: {
		rootComment: createMockComment({
			content_text:
				'This is a very long comment that goes on for quite a while to demonstrate the show more / show less functionality. '.repeat(
					8,
				),
		}),
		replies: [],
	},
}

const veryLongContent = [
	'This comment contains a large code block and lots of text to demonstrate the scrollable expanded state.',
	'',
	'```typescript',
	...Array.from({ length: 30 }, (_, i) => `  const value${i} = compute(${i});`),
	'```',
	'',
	...Array.from({ length: 10 }, (_, i) => `Paragraph ${i + 1}: ${'This is additional context that makes the comment very long. '.repeat(3)}`),
].join('\n')

export const VeryLongComment: Story = {
	args: {
		rootComment: createMockComment({
			content_text: veryLongContent,
		}),
		replies: [],
	},
}

export const AgentRoot: Story = {
	args: {
		rootComment: agentCreatedComment,
		replies: [],
	},
}

export const AgentReplyInThread: Story = {
	args: {
		rootComment: inlineComment,
		replies: [agentReplyComment],
	},
}
