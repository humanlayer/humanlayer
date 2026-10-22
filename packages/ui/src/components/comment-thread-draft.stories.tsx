import type { Meta, StoryObj } from '@storybook/react'
import { fn } from 'storybook/test'
import { draftSessionStorageKeys } from '../lib/draft-session-storage-keys'
import { inlineComment } from './__stories__/comment-fixtures'
import { CommentThread } from './comment-thread'

function SeededReplyDraftDemo() {
	if (typeof window !== 'undefined') {
		window.sessionStorage.setItem(
			draftSessionStorageKeys.reply(inlineComment.id),
			JSON.stringify('A half-written reply that survived a reload.'),
		)
	}

	return (
		<div className="w-80">
			<CommentThread
				rootComment={inlineComment}
				replies={[]}
				onReply={fn()}
				onDelete={fn()}
				currentUserId="user_abc1"
			/>
		</div>
	)
}

const meta = {
	title: 'Shell Demos/CommentThreadDraft',
	component: SeededReplyDraftDemo,
	parameters: { layout: 'centered' },
} satisfies Meta<typeof SeededReplyDraftDemo>

export default meta
type Story = StoryObj<typeof meta>

export const SeededReplyDraft: Story = {}
