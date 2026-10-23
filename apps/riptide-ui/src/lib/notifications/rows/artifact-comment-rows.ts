import type { NotificationActor, NotificationRow } from '../notification-row'
import type { NotificationArtifactComment } from '../notification-sources'
import { createCommentGroups } from './comment-groups'
import type { RowContext } from './row-context'
import { toMillis } from './row-text'

export function artifactCommentRows(context: RowContext): NotificationRow[] {
	const comments = context.sources.artifactComments
	const resolvedRoots = new Set(comments.filter((comment) => comment.is_resolved).map((comment) => comment.id))
	const threadsIWroteIn = new Set(
		comments
			.filter((comment) => comment.created_by_user_id === context.userId && !comment.is_deleted)
			.map(rootIdOf),
	)

	const groups = createCommentGroups(context)
	for (const comment of comments) {
		if (comment.is_deleted || comment.created_by_user_id === context.userId) continue
		const rootId = rootIdOf(comment)
		if (resolvedRoots.has(rootId)) continue
		const onMyArtifact = comment.resource_owner_user_id === context.userId
		const replyInMyThread = comment.reply_to_comment_id !== null && threadsIWroteIn.has(rootId)
		if (!onMyArtifact && !replyInMyThread) continue

		groups.add(
			{
				key: onMyArtifact ? `artifact_comment:${comment.artifact_id}` : `thread_reply:${rootId}`,
				kind: onMyArtifact ? 'artifact_comment' : 'thread_reply',
				subject: context.artifact(comment.artifact_id)?.file_name ?? 'an artifact',
				taskId: comment.task_id,
				destination: (commentId) => ({
					kind: 'artifact-comment',
					taskId: comment.task_id,
					artifactId: comment.artifact_id,
					commentId,
				}),
			},
			{ id: comment.id, at: toMillis(comment.created_at), actor: actorOf(comment), text: comment.content_text },
		)
	}
	return groups.rows()
}

function rootIdOf(comment: NotificationArtifactComment): string {
	return comment.reply_to_comment_id ?? comment.id
}

function actorOf(comment: NotificationArtifactComment): NotificationActor {
	return comment.created_by_user_id
		? { userId: comment.created_by_user_id }
		: { guestName: comment.anonymous_guest_name ?? 'A guest' }
}
