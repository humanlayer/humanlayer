import type { Meta, StoryObj } from '@storybook/react'
import { fn } from 'storybook/test'
import { createMockComment, inlineComment, mockUsers } from './__stories__/comment-fixtures'
import { CommentColumn } from './comment-column'

const userLookup = new Map(
	Object.values(mockUsers).map((u) => [u.userId, { displayName: u.displayName, avatarUrl: u.avatarUrl }]),
)

const meta = {
	title: 'Comments/CommentColumn',
	component: CommentColumn,
	parameters: { layout: 'padded' },
	tags: ['autodocs'],
	args: {
		onReply: fn(),
		onDelete: fn(),
		onResolve: fn(),
		currentUserId: 'user_abc1',
		userLookup,
	},
	decorators: [
		(Story) => (
			<div className="h-[600px] relative w-80">
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof CommentColumn>

export default meta
type Story = StoryObj<typeof meta>

const comment1 = createMockComment({
	highlighted_text: 'const result = await fetchData()',
	highlighted_text_line_number: 5,
	highlighted_text_has_match_in_current_artifact: true,
	content_text: 'Should we cache this result?',
})

const comment2 = createMockComment({
	highlighted_text: 'return response.data',
	highlighted_text_line_number: 20,
	highlighted_text_has_match_in_current_artifact: true,
	content_text: 'Add error handling here.',
	created_by_user_id: 'user_abc2',
})

export const Empty: Story = {
	args: {
		inlineComments: new Map(),
		linePositions: new Map(),
	},
}

export const SingleThread: Story = {
	args: {
		inlineComments: new Map([[5, [{ root: comment1, replies: [] }]]]),
		linePositions: new Map([[5, 80]]),
	},
}

export const MultipleThreads: Story = {
	args: {
		inlineComments: new Map([
			[5, [{ root: comment1, replies: [] }]],
			[20, [{ root: comment2, replies: [] }]],
		]),
		linePositions: new Map([
			[5, 80],
			[20, 320],
		]),
	},
}

export const SameLineStacked: Story = {
	args: {
		inlineComments: new Map([
			[
				12,
				[
					{ root: inlineComment, replies: [] },
					{ root: comment1, replies: [] },
					{ root: comment2, replies: [] },
				],
			],
		]),
		linePositions: new Map([[12, 192]]),
	},
}

