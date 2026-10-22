import type { ChangesRequestedReviewType, PullRequestRowType } from '@humanlayer/streams/pr-status'
import { ExternalLink } from 'lucide-react'
import type { FC } from 'react'

import { cn } from '@/lib/utils'

import {
	changesRequestedReviewsOf,
	firstLineOf,
	isReviewBlockVisible,
	reviewKeyOf,
	unresolvedThreadsOf,
} from './review-block'
import { REVIEW_DECISION_LABELS } from './review-decision'

// `--terminal-error` and `-warning` have no `@theme` alias, so these stay arbitrary values.
const CHANGES_REQUESTED_TEXT = 'text-[var(--terminal-error)]'
const CHANGES_REQUESTED_SURFACE = 'border-l-[var(--terminal-error)] bg-[var(--terminal-error)]/6'
const OPEN_THREADS_TEXT = 'text-[var(--terminal-warning)]'
const OPEN_THREADS_SURFACE = 'border-l-[var(--terminal-warning)] bg-[var(--terminal-warning)]/6'

/**
 * One reviewer's standing objection as a single row: who, their opening line, and a way out to the
 * review. The panel reports; GitHub renders the conversation, so the line truncates rather than
 * growing the panel.
 */
const ChangesRequestedRow: FC<{ review: ChangesRequestedReviewType }> = ({ review }) => {
	const label = `${review.login ? `@${review.login}` : 'A reviewer'}: ${firstLineOf(review.body)}`
	const line = (
		<>
			<span className="min-w-0 flex-1 truncate">{label}</span>
			{review.url ? <ExternalLink aria-hidden className="h-2.5 w-2.5 shrink-0" /> : null}
		</>
	)
	const className = 'flex min-w-0 items-center gap-1 py-0.5 pl-2.5 pr-2 text-[11px] text-muted-foreground'

	if (!review.url) {
		return (
			<div className={className} title={label} data-testid="changes-requested-review">
				{line}
			</div>
		)
	}
	return (
		<a
			href={review.url}
			target="_blank"
			rel="noreferrer"
			title={label}
			data-testid="changes-requested-review"
			className={cn(className, 'hover:text-[var(--terminal-accent)]')}
		>
			{line}
		</a>
	)
}

export interface PullRequestReviewBlockProps {
	pullRequest: PullRequestRowType
}

/**
 * What a reviewer thinks of the pull request: the unresolved thread count as the largest element,
 * the decision and the resolved count beneath it, then one line per standing changes-requested
 * review. Reports only; GitHub renders the conversation.
 */
export const PullRequestReviewBlock: FC<PullRequestReviewBlockProps> = ({ pullRequest }) => {
	if (!isReviewBlockVisible(pullRequest)) return null
	const unresolved = unresolvedThreadsOf(pullRequest)
	const resolved = pullRequest.resolvedThreadCount ?? 0
	const reviews = changesRequestedReviewsOf(pullRequest)
	const changesRequested = pullRequest.reviewDecision === 'CHANGES_REQUESTED' || reviews.length > 0
	const decisionLabel = pullRequest.reviewDecision ? REVIEW_DECISION_LABELS[pullRequest.reviewDecision] : null
	const meta = [unresolved > 0 ? decisionLabel : null, `${resolved} resolved`].filter(Boolean).join(' · ')

	return (
		<div data-testid="pull-request-review-block">
			<div
				className={cn(
					'border-l-2 px-2.5 py-2',
					changesRequested ? CHANGES_REQUESTED_SURFACE : OPEN_THREADS_SURFACE,
				)}
			>
				{unresolved > 0 ? (
					<div className="flex min-w-0 items-baseline gap-2">
						<span
							className={cn(
								'shrink-0 font-mono text-xl leading-none font-semibold',
								changesRequested ? CHANGES_REQUESTED_TEXT : OPEN_THREADS_TEXT,
							)}
						>
							{unresolved}
						</span>
						<span className="min-w-0 truncate text-[11px]">
							unresolved {unresolved === 1 ? 'thread' : 'threads'}
						</span>
					</div>
				) : (
					<div className={cn('text-[11px]', CHANGES_REQUESTED_TEXT)}>
						{REVIEW_DECISION_LABELS.CHANGES_REQUESTED}
					</div>
				)}
				<div className="mt-1 font-mono text-[10px] text-muted-foreground">{meta}</div>
			</div>
			{reviews.map((review) => (
				<ChangesRequestedRow key={reviewKeyOf(review)} review={review} />
			))}
		</div>
	)
}
