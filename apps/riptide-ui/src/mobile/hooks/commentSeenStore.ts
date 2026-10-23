import type { ArtifactComment } from '@humanlayer/db/tables/artifact-comments'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

const MAX_TRACKED_THREADS = 1000

interface CommentSeenState {
	/** Root comment id → epoch ms when the user last viewed that thread. */
	lastSeenByThread: Record<string, number>
	markThreadsSeen: (rootCommentIds: string[]) => void
}

/**
 * Tracks which comment threads the user has viewed on mobile, so new agent
 * (or teammate) activity can be surfaced as unread markers. Threads are
 * marked seen when the user closes or navigates away from them in the
 * comment drawer — not on open, so the markers stay visible while reading.
 */
export const useCommentSeenStore = create<CommentSeenState>()(
	persist(
		(set) => ({
			lastSeenByThread: {},
			markThreadsSeen: (rootCommentIds) =>
				set((state) => {
					if (rootCommentIds.length === 0) return state
					const now = Date.now()
					const updated = { ...state.lastSeenByThread }
					for (const id of rootCommentIds) updated[id] = now
					// Bound growth: drop the oldest-seen threads beyond the cap.
					const entries = Object.entries(updated)
					if (entries.length > MAX_TRACKED_THREADS) {
						entries.sort((a, b) => b[1] - a[1])
						return { lastSeenByThread: Object.fromEntries(entries.slice(0, MAX_TRACKED_THREADS)) }
					}
					return { lastSeenByThread: updated }
				}),
		}),
		{ name: 'riptide-mobile-comment-seen' },
	),
)

/**
 * A thread is unread when it has unresolved activity the user hasn't viewed
 * that came from someone else — another user, or any agent (agent comments
 * carry the driving user's id, so `created_by_agent` must be checked
 * explicitly). Resolution suppresses only that comment, so a new unresolved
 * reply on a resolved thread can still make the thread unread.
 */
export function isThreadUnread(
	lastSeenByThread: Record<string, number>,
	currentUserId: string | null | undefined,
	root: ArtifactComment,
	replies: ArtifactComment[],
): boolean {
	if (!currentUserId) return false
	const seenAt = lastSeenByThread[root.id] ?? 0
	return [root, ...replies].some(
		(comment) =>
			!comment.is_resolved &&
			(comment.created_by_agent || comment.created_by_user_id !== currentUserId) &&
			Number(comment.created_at) > seenAt,
	)
}
