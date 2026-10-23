import type { PullRequestRowType } from '@humanlayer/streams/pr-status'

export type ReviewDecision = NonNullable<PullRequestRowType['reviewDecision']>

export const REVIEW_DECISION_LABELS: Record<ReviewDecision, string> = {
	APPROVED: 'Approved',
	CHANGES_REQUESTED: 'Changes requested',
	REVIEW_REQUIRED: 'Review required',
}
