/**
 * Pure unresolved-comment summarization for a kanban card.
 *
 * Operates on plain comment rows for a single task — no React, no queries — so
 * the thread-counting and participant-dedup rules are trivially unit-testable.
 */

/** Minimal comment shape the summarizer needs. */
export interface KanbanCommentInput {
	id: string
	created_by_user_id: string | null
	reply_to_comment_id: string | null
	/** Defaults to false when omitted. */
	is_deleted?: boolean | null
	/** Defaults to false when omitted. */
	is_resolved?: boolean | null
}

export interface TaskCommentSummary {
	/** Number of unresolved root threads (comments with no `reply_to_comment_id`). */
	count: number
	/** Unique participant user ids across all unresolved comments (threads + repliers). */
	participantIds: string[]
}

/**
 * Summarize a task's comment rows into a thread count + participant id set.
 *
 * Only unresolved, non-deleted comments contribute. The thread count is the
 * number of root comments (those without a `reply_to_comment_id`); participant
 * ids are the unique creators across every contributing comment, including
 * repliers. Participant order follows first appearance.
 */
export function summarizeTaskComments(comments: KanbanCommentInput[]): TaskCommentSummary {
	let count = 0
	const participantIds: string[] = []
	const seen = new Set<string>()

	for (const comment of comments) {
		if (comment.is_deleted) continue
		if (comment.is_resolved) continue

		if (!comment.reply_to_comment_id) {
			count += 1
		}

		const userId = comment.created_by_user_id
		if (userId && !seen.has(userId)) {
			seen.add(userId)
			participantIds.push(userId)
		}
	}

	return { count, participantIds }
}
