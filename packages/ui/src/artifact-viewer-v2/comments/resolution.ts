import type { ProjectedCommentThread } from './project-comments'

export interface ThreadResolutionPartition {
	/** Unresolved threads — the only ones that emit document highlights. */
	open: ProjectedCommentThread[]
	/** Resolved threads — shown in the rail under Resolved and All. */
	resolved: ProjectedCommentThread[]
}

/**
 * A thread's effective resolution state is its ROOT row's persisted
 * `is_resolved`. The server resolve/unresolve procedure cascades across the
 * whole flattened thread, so every reply follows its root; the root is the
 * single authority for presentation. This intentionally ignores each reply
 * row's own `is_resolved`, so an in-flight optimistic root update moves the
 * entire thread atomically even before the cascade reconciles the replies.
 */
export function isThreadResolved(thread: ProjectedCommentThread): boolean {
	return thread.root.is_resolved
}

/**
 * Partition already-projected threads into open vs resolved by their root's
 * effective state. Pure and order-preserving: callers sort each bucket with the
 * projection's own comparator afterward. Replies stay attached to their root, so
 * they follow the root into whichever bucket it lands in.
 */
export function partitionThreadsByResolution(
	threads: readonly ProjectedCommentThread[],
): ThreadResolutionPartition {
	const open: ProjectedCommentThread[] = []
	const resolved: ProjectedCommentThread[] = []
	for (const thread of threads) {
		if (isThreadResolved(thread)) resolved.push(thread)
		else open.push(thread)
	}
	return { open, resolved }
}
