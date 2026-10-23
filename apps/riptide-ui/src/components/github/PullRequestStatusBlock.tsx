import type { PullRequestRowType } from '@humanlayer/streams/pr-status'
import { Tooltip, TooltipContent, TooltipTrigger } from '@humanlayer/ui/components/tooltip'
import { format } from 'date-fns'
import { ArrowRight, Check, Clock, ExternalLink, GitBranch, TriangleAlert, X } from 'lucide-react'
import type { FC, ReactNode } from 'react'

import { PullRequestLifecyclePill } from './PullRequestLifecyclePill'
import { REVIEW_DECISION_LABELS, type ReviewDecision } from './review-decision'
import { type PillStyle, StatusPill } from './StatusPill'

// `--terminal-success` and `-warning` have no `@theme` alias, so these two stay arbitrary values.
const SUCCESS_PILL = 'text-[var(--terminal-success)] border-[var(--terminal-success)]/50'
const WARNING_PILL = 'text-[var(--terminal-warning)] border-[var(--terminal-warning)]/50'
const ERROR_PILL = 'text-destructive border-destructive/50'

const REVIEW_DECISIONS: Record<ReviewDecision, PillStyle> = {
	APPROVED: { icon: Check, label: REVIEW_DECISION_LABELS.APPROVED, className: SUCCESS_PILL },
	CHANGES_REQUESTED: { icon: X, label: REVIEW_DECISION_LABELS.CHANGES_REQUESTED, className: ERROR_PILL },
	REVIEW_REQUIRED: { icon: Clock, label: REVIEW_DECISION_LABELS.REVIEW_REQUIRED, className: WARNING_PILL },
}

const CONFLICTS: PillStyle = { icon: TriangleAlert, label: 'Conflicts', className: ERROR_PILL }

const StaleNotice: FC<{ staleSince?: number | null }> = ({ staleSince }) =>
	typeof staleSince !== 'number' ? null : (
		<div role="status" className="font-mono text-xs text-muted-foreground" data-testid="pr-status-stale-notice">
			last updated {format(staleSince, 'HH:mm')}
		</div>
	)

const branchIcon = <GitBranch aria-hidden className="h-3 w-3 shrink-0 text-muted-foreground" />

const OpenOnGitHubLink: FC<{ url: string }> = ({ url }) => (
	<a
		href={url}
		target="_blank"
		rel="noreferrer"
		className="inline-flex w-fit items-center gap-1 rounded-none border border-accent/50 px-1.5 py-0.5 font-mono text-xs uppercase tracking-wide text-accent hover:bg-accent hover:text-accent-foreground"
	>
		<ExternalLink aria-hidden className="h-3 w-3 shrink-0" />
		Open on GitHub
	</a>
)

export interface PullRequestStatusBlockProps {
	pullRequest: PullRequestRowType | null
	/** From `ensureStream`. Names the branch before a pull request exists. */
	branch: string | null
	/**
	 * A lifecycle control (`Draft | Ready`) rendered between the title and the badges. Empty until
	 * Phase 6 — the slot exists so adding it does not move anything else.
	 */
	lifecycleControl?: ReactNode
	/** When the stream stopped answering, or `null` while it is healthy. Adds the time it was last current. */
	staleSince?: number | null
}

/**
 * Identity, lifecycle and location for one pull request. `mergeable === null` (GitHub still
 * computing) renders as absent, not a conflict; `reviewDecision` and conflicts show only while
 * the pull request is open.
 */
export const PullRequestStatusBlock: FC<PullRequestStatusBlockProps> = ({
	pullRequest,
	branch,
	lifecycleControl,
	staleSince,
}) => {
	if (!pullRequest) {
		return (
			<div className="flex flex-col gap-1.5 px-1 py-2 text-xs" data-testid="pull-request-status-block">
				<div className="text-muted-foreground">No pull request on this branch</div>
				{branch ? (
					<div className="flex min-w-0 items-center gap-1.5 font-mono text-xs">
						{branchIcon}
						<span className="min-w-0 truncate">{branch}</span>
					</div>
				) : null}
				<StaleNotice staleSince={staleSince} />
			</div>
		)
	}

	const isOpen = pullRequest.state === 'open'
	const reviewDecision =
		isOpen && !pullRequest.isDraft && pullRequest.reviewDecision !== null
			? REVIEW_DECISIONS[pullRequest.reviewDecision]
			: null
	const showConflicts = isOpen && pullRequest.mergeable === false

	return (
		<div className="flex flex-col gap-1.5 px-1 py-2" data-testid="pull-request-status-block">
			<a
				href={pullRequest.url}
				target="_blank"
				rel="noreferrer"
				className="group flex min-w-0 items-baseline gap-1.5 hover:text-accent"
			>
				<span className="shrink-0 font-mono text-xs text-muted-foreground group-hover:text-accent">
					#{pullRequest.number}
				</span>
				<Tooltip>
					<TooltipTrigger asChild>
						<span className="min-w-0 flex-1 truncate text-xs">{pullRequest.title}</span>
					</TooltipTrigger>
					<TooltipContent side="bottom" className="max-w-md break-words text-xs">
						{pullRequest.title}
					</TooltipContent>
				</Tooltip>
			</a>

			{lifecycleControl}

			<div className="flex flex-wrap items-center gap-1">
				<PullRequestLifecyclePill pullRequest={pullRequest} />
				{reviewDecision ? <StatusPill {...reviewDecision} /> : null}
				{showConflicts ? <StatusPill {...CONFLICTS} /> : null}
			</div>

			<div className="flex min-w-0 items-center gap-1.5 font-mono text-xs text-muted-foreground">
				{branchIcon}
				<span className="min-w-0 max-w-[45%] truncate text-foreground">{pullRequest.headRef}</span>
				<ArrowRight aria-hidden className="h-3 w-3 shrink-0" />
				<span className="min-w-0 max-w-[45%] truncate text-foreground">{pullRequest.baseRef}</span>
			</div>
			<OpenOnGitHubLink url={pullRequest.url} />
			<StaleNotice staleSince={staleSince} />
		</div>
	)
}
