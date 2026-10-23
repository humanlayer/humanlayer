import type { CheckRowType, PullRequestRowType } from '@humanlayer/streams/pr-status'
import { GitBranch } from 'lucide-react'
import type { FC, ReactNode } from 'react'

import type { GitHubPanelState } from './panel-state'
import { type CheckDeliveryControls, PullRequestChecksBlock } from './PullRequestChecksBlock'
import { PullRequestReviewBlock } from './PullRequestReviewBlock'
import { PullRequestStatusBlock } from './PullRequestStatusBlock'

/** The end of the road for a branch whose status the server could not answer for. */
const PullRequestUnavailable: FC<{ branch: string | null }> = ({ branch }) => (
	<div role="status" className="flex flex-col gap-1.5 px-1 py-2 text-xs" data-testid="pull-request-unavailable">
		<div className="text-muted-foreground">Pull request status unavailable</div>
		{branch ? (
			<div className="flex min-w-0 items-center gap-1.5 font-mono text-xs">
				<GitBranch aria-hidden className="h-3 w-3 shrink-0 text-muted-foreground" />
				<span className="min-w-0 truncate">{branch}</span>
			</div>
		) : null}
	</div>
)

/**
 * Marks a panel drawn from the record alone as out of date. Names no cause: what failed is the
 * status stream, so blaming GitHub would send the reader to the wrong status page.
 */
const RecordedNotice: FC = () => (
	<div
		role="status"
		className="px-1 font-mono text-xs text-muted-foreground"
		data-testid="pull-request-recorded-notice"
	>
		couldn't refresh · showing the last saved state
	</div>
)

export interface SidebarWidgetGitHubProps {
	pullRequest: PullRequestRowType | null
	branch: string | null
	checks: CheckRowType[]
	/** `ensureStream` already knows whether the branch has one, before the stream replays it. */
	hasPullRequest?: boolean
	/** What the section can honestly say about this branch right now. */
	state?: GitHubPanelState
	staleSince?: number | null
	/** The session's prompt delivery; absent on a task page, where nothing can be sent. */
	delivery?: CheckDeliveryControls | null
	/** The merge row, at the bottom; absent while nothing on the pull request can be pressed. */
	children?: ReactNode
}

const PullRequestHeader: FC<
	Pick<SidebarWidgetGitHubProps, 'pullRequest' | 'branch' | 'hasPullRequest' | 'staleSince'> & {
		state: GitHubPanelState
	}
> = ({ pullRequest, branch, hasPullRequest, staleSince, state }) => {
	if (state === 'unavailable') return <PullRequestUnavailable branch={branch} />
	if (!pullRequest && (hasPullRequest || state === 'loading')) {
		return (
			<div className="px-1 py-2 text-xs text-muted-foreground" data-testid="pull-request-loading">
				Loading pull request…
			</div>
		)
	}
	return <PullRequestStatusBlock pullRequest={pullRequest} branch={branch} staleSince={staleSince} />
}

export const SidebarWidgetGitHub: FC<SidebarWidgetGitHubProps> = ({
	pullRequest,
	branch,
	checks,
	hasPullRequest,
	state = 'live',
	staleSince,
	delivery = null,
	children,
}) => (
	<div className="flex h-full min-h-0 flex-col gap-2 overflow-y-auto" data-testid="sidebar-widget-github">
		<PullRequestHeader
			pullRequest={pullRequest}
			branch={branch}
			hasPullRequest={hasPullRequest}
			staleSince={staleSince}
			state={state}
		/>
		{state === 'recorded' ? <RecordedNotice /> : null}
		<PullRequestChecksBlock checks={checks} delivery={delivery} />
		{pullRequest ? <PullRequestReviewBlock pullRequest={pullRequest} /> : null}
		{children}
	</div>
)
