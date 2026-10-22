import type { ProjectedCommentThread } from './project-comments'
import { isThreadResolved } from './resolution'

/**
 * A resolved thread the rail keeps rendering while its dismissal animation
 * plays. `index` is the position the card held in the visible open list at the
 * moment it resolved, so the snapshot collapses in place.
 */
export interface DismissingThread {
	thread: ProjectedCommentThread
	index: number
}

/**
 * Threads that left the visible list because they were resolved: open in the
 * previous list, now in the resolved projection. Deletion, filter changes,
 * already-resolved threads, and anchors going outdated do not animate.
 */
export function collectDismissedThreads(
	previousVisible: readonly ProjectedCommentThread[],
	visibleRootIds: ReadonlySet<string>,
	resolvedRootIds: ReadonlySet<string>,
): DismissingThread[] {
	return previousVisible
		.map((thread, index) => ({ thread, index }))
		.filter(
			({ thread }) =>
				!isThreadResolved(thread) && !visibleRootIds.has(thread.root.id) && resolvedRootIds.has(thread.root.id),
		)
}

/**
 * Interleaves dismissing snapshots back into the current visible list at the
 * indices they occupied before resolving, so remaining cards do not jump while
 * the departed ones collapse.
 */
export function mergeDismissingThreads(
	visible: readonly ProjectedCommentThread[],
	dismissing: readonly DismissingThread[],
): { thread: ProjectedCommentThread; dismissing: boolean }[] {
	const merged = visible.map((thread) => ({ thread, dismissing: false }))
	for (const entry of [...dismissing].sort((a, b) => a.index - b.index)) {
		merged.splice(Math.min(entry.index, merged.length), 0, { thread: entry.thread, dismissing: true })
	}
	return merged
}
