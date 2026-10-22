import type { ChangesRequestedReviewType, PullRequestRowType } from '@humanlayer/streams/pr-status'

export const unresolvedThreadsOf = (pullRequest: PullRequestRowType): number => pullRequest.unresolvedThreadCount ?? 0

export const changesRequestedReviewsOf = (pullRequest: PullRequestRowType): readonly ChangesRequestedReviewType[] =>
	pullRequest.changesRequestedReviews ?? []

/**
 * A review is work to do while the pull request is alive: an unresolved thread, or a reviewer who
 * asked for changes and said why. Merged is the one lifecycle state that hides it, because the
 * panel is then a record. Draft, closed and every decision get the block like anything else.
 */
export const isReviewBlockVisible = (pullRequest: PullRequestRowType): boolean =>
	pullRequest.state !== 'merged' &&
	(unresolvedThreadsOf(pullRequest) > 0 || changesRequestedReviewsOf(pullRequest).length > 0)

/** The opening line of a review, which is where a reviewer says what they want. */
export const firstLineOf = (body: string): string => {
	for (const line of body.split('\n')) {
		const trimmed = line.trim()
		if (trimmed) return trimmed
	}
	return ''
}

/** Identifies a review across re-renders: its own URL, else the reviewer and when they submitted. */
export const reviewKeyOf = (review: ChangesRequestedReviewType): string =>
	review.url ?? `${review.login ?? ''}:${review.submittedAt ?? ''}`
