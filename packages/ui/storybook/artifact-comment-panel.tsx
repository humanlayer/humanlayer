import { forwardRef } from 'react'
import { fn } from 'storybook/test'

import { mockUsers } from '../src/components/__stories__/comment-fixtures'
import {
	type ArtifactCommentPanelHandle,
	type ArtifactCommentPanelProps,
	ArtifactCommentPanel,
	NEW_COMMENT_KEY,
	useCommentThreads,
} from '../src/components/artifact-comment-panel'
import { CommentThread } from '../src/components/comment-thread'
import { NewCommentForm } from '../src/components/new-comment-form'

const userLookup = new Map(
	Object.values(mockUsers).map((user) => [user.userId, { displayName: user.displayName, avatarUrl: user.avatarUrl }]),
)

export interface ArtifactCommentPanelDemoProps extends Omit<ArtifactCommentPanelProps, 'children'> {
	showNewComment?: boolean
}

/** ShellDemo composition of the pure panel, thread, and form components. */
export const ArtifactCommentPanelDemo = forwardRef<ArtifactCommentPanelHandle, ArtifactCommentPanelDemoProps>(
	function ArtifactCommentPanelDemo({ showNewComment = false, ...panelProps }, ref) {
		const { inlineThreadsFlat, generalThreads } = useCommentThreads(
			panelProps.comments,
			panelProps.computedLineNumbers,
		)
		const panelThreads = [
			...inlineThreadsFlat,
			...generalThreads.filter((thread) => thread.root.commented_upon_block_text != null),
		]
		const outdatedIds = new Set(generalThreads.map((thread) => thread.root.id))

		return (
			<ArtifactCommentPanel ref={ref} {...panelProps}>
				{panelThreads.map(({ root, replies }) => (
					<CommentThread
						key={root.id}
						rootComment={root}
						replies={replies}
						onReply={fn()}
						onDelete={fn()}
						onResolve={fn()}
						onUnresolve={fn()}
						currentUserId="user_abc1"
						userLookup={userLookup}
						isOutdated={outdatedIds.has(root.id)}
					/>
				))}
				{showNewComment && (
					<NewCommentForm
						key={NEW_COMMENT_KEY}
						artifactId="artifact_story"
						onSubmit={fn()}
						currentUserDisplayName={mockUsers.user1.displayName}
					/>
				)}
			</ArtifactCommentPanel>
		)
	},
)
