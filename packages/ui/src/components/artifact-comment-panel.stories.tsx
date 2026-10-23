import type { ArtifactComment } from '@humanlayer/db/tables/artifact-comments'
import type { Meta, StoryObj } from '@storybook/react'
import { userEvent, within } from 'storybook/test'
import { ArtifactCommentPanelDemo } from '../../storybook/artifact-comment-panel'
import {
	createMockComment,
	inlineComment,
	outdatedComment,
	replyComment,
	resolvedComment,
} from './__stories__/comment-fixtures'

const inlineLineNumbers = (comments: ArtifactComment[]) =>
	new Map(comments.filter((comment) => comment.commented_upon_block_text != null).map((comment, index) => [comment.id, 12 + index]))

const meta = {
	title: 'Shell Demos/ArtifactCommentPanel',
	component: ArtifactCommentPanelDemo,
	parameters: { layout: 'padded' },
	tags: ['autodocs'],
	args: {
		linePositions: new Map(),
		comments: [],
	},
	decorators: [
		(Story) => (
			<div className="max-w-sm min-h-96 p-4 border rounded-md">
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof ArtifactCommentPanelDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = {}

export const InlineWithReplies: Story = {
	args: {
		comments: [inlineComment, replyComment],
		computedLineNumbers: new Map([[inlineComment.id, 12]]),
		linePositions: new Map([[12, 192]]),
	},
}

export const WithResolvedThread: Story = {
	args: {
		comments: [
			inlineComment,
			{ ...resolvedComment, commented_upon_block_text: 'return result' },
		],
		computedLineNumbers: inlineLineNumbers([
			inlineComment,
			{ ...resolvedComment, commented_upon_block_text: 'return result' },
		]),
		linePositions: new Map([[12, 80], [13, 240]]),
	},
}

const outdatedComment2 = createMockComment({
	id: 'outdated-2',
	commented_upon_block_text: 'function deprecatedAPI()',
	content_text: 'This API was removed in v2.0',
	created_by_user_id: 'user_abc2',
})

export const WithOutdatedComments: Story = {
	args: {
		comments: [inlineComment, outdatedComment, outdatedComment2],
		computedLineNumbers: new Map([[inlineComment.id, 12]]),
		linePositions: new Map([[12, 192]]),
	},
}

export const OutdatedInLayoutFlow: Story = {
	args: {
		comments: [inlineComment, replyComment, outdatedComment, outdatedComment2],
		computedLineNumbers: new Map([[inlineComment.id, 12]]),
		linePositions: new Map([[12, 192]]),
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		await userEvent.click(await canvas.findByRole('button', { name: /outdated comment/i }))
	},
}

export const WithNewComment: Story = {
	args: {
		comments: [inlineComment],
		computedLineNumbers: new Map([[inlineComment.id, 12]]),
		linePositions: new Map([[12, 80]]),
		newCommentY: 240,
		showNewComment: true,
	},
}
