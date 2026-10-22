import type { NotificationRow } from '../notification-row'
import { createCommentGroups } from './comment-groups'
import type { RowContext } from './row-context'
import { toMillis } from './row-text'

export function diffCommentRows(context: RowContext): NotificationRow[] {
	const comments = context.sources.diffComments
	const byId = new Map(comments.map((comment) => [comment.id, comment]))
	const tasksWithMySession = new Set(
		context.sources.sessions
			.filter((session) => session.resource_owner_user_id === context.userId)
			.map((session) => session.task_id),
	)

	const groups = createCommentGroups(context)
	for (const comment of comments) {
		if (comment.is_deleted || comment.created_by_user_id === context.userId) continue
		if (comment.resource_owner_user_id !== context.userId && !tasksWithMySession.has(comment.task_id)) continue
		const rootId = comment.reply_to_comment_id ?? comment.id
		const root = byId.get(rootId)
		if (root?.is_resolved) continue

		groups.add(
			{
				key: `diff_comment:${rootId}`,
				kind: 'diff_comment',
				subject: root?.anchor_json?.path ?? comment.anchor_json?.path ?? 'a diff',
				taskId: comment.task_id,
				destination: (diffCommentId) => ({ kind: 'diff-comment', taskId: comment.task_id, diffCommentId }),
			},
			{
				id: comment.id,
				at: toMillis(comment.created_at),
				actor: { userId: comment.created_by_user_id },
				text: comment.content_text,
			},
		)
	}
	return groups.rows()
}
