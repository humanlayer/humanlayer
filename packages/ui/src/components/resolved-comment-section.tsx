import type { ArtifactComment } from '@humanlayer/db/tables/artifact-comments'
import { type UserInfo, CommentThread } from './comment-thread'

interface ResolvedCommentSectionProps {
	threads: Array<{ root: ArtifactComment; replies: ArtifactComment[] }>
	onReply: (parentCommentId: string, contentText: string, contentJson: string) => void
	onDelete: (commentId: string) => void
	onEdit?: (commentId: string, contentText: string, contentJson: string) => void
	onUnresolve?: (commentId: string) => void
	currentUserId: string
	userLookup?: Map<string, UserInfo>
}

export function ResolvedCommentSection({
	threads,
	onReply,
	onDelete,
	onEdit,
	onUnresolve,
	currentUserId,
	userLookup,
}: ResolvedCommentSectionProps) {
	if (threads.length === 0) {
		return null
	}

	return (
		<div className="space-y-3">
			{threads.map(({ root, replies }) => (
				<CommentThread
					key={root.id}
					rootComment={root}
					replies={replies}
					onReply={onReply}
					onDelete={onDelete}
					onEdit={onEdit}
					onUnresolve={onUnresolve}
					currentUserId={currentUserId}
					userLookup={userLookup}
				/>
			))}
		</div>
	)
}
