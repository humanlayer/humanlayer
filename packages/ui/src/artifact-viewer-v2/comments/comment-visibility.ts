import { compareThreads, type ProjectedCommentThread } from './project-comments'

/**
 * The review rail's completion filter. Membership depends only on the root's
 * persisted completion, never on anchor placement — an Outdated thread stays
 * in whichever bucket its completion puts it:
 * - `open`     — every unresolved thread, located or Outdated.
 * - `resolved` — every resolved thread, located or Outdated.
 * - `all`      — both, in one list.
 */
export type CommentVisibility = 'open' | 'resolved' | 'all'

/** The completion bucket a thread belongs to. */
export type CommentThreadBucket = 'open' | 'resolved'

export function isCommentVisibility(value: unknown): value is CommentVisibility {
	return value === 'open' || value === 'resolved' || value === 'all'
}

/** True when the `current` rail filter shows threads in `bucket`. */
export function commentVisibilityIncludes(current: CommentVisibility, bucket: CommentThreadBucket): boolean {
	return current === 'all' || current === bucket
}

/**
 * The filter that reveals a thread in `bucket`: keep a compatible filter,
 * otherwise switch to the thread's own bucket.
 */
export function visibilityRevealing(current: CommentVisibility, bucket: CommentThreadBucket): CommentVisibility {
	return commentVisibilityIncludes(current, bucket) ? current : bucket
}

/**
 * The threads a rail shows under `visibility`, in rail order. All merges both
 * buckets with the same order each bucket already uses, so open and resolved
 * threads interleave by document position.
 */
export function visibleThreads(
	threads: ProjectedCommentThread[],
	resolvedThreads: ProjectedCommentThread[],
	visibility: CommentVisibility,
): ProjectedCommentThread[] {
	if (visibility === 'open') return threads
	if (visibility === 'resolved') return resolvedThreads
	return [...threads, ...resolvedThreads].sort(compareThreads)
}

const EMPTY_LABEL: Record<CommentVisibility, string> = {
	open: 'No open comments',
	resolved: 'No resolved comments',
	all: 'No comments yet',
}

/** Filter-specific empty state, or null when the filter shows something. */
export function commentVisibilityEmptyLabel(
	visibility: CommentVisibility,
	counts: { open: number; resolved: number },
): string | null {
	const shown =
		(commentVisibilityIncludes(visibility, 'open') ? counts.open : 0) +
		(commentVisibilityIncludes(visibility, 'resolved') ? counts.resolved : 0)
	return shown > 0 ? null : EMPTY_LABEL[visibility]
}
