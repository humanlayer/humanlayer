import type { PullRequestScope } from '@humanlayer/riptide-api-contract/api/integrations/github/pull-requests/ensure-stream'
import type {
	PanelPullRequest,
	PullRequestBranch,
} from '@humanlayer/riptide-api-contract/api/integrations/github/pull-requests/list-branches'
import type { PullRequestRowType } from '@humanlayer/streams/pr-status'

import type { PrStatusStreamResult } from '@/hooks/session-detail/usePrStatusStream'

/** One section per repository and branch: the same key the stream is addressed by. */
export const pullRequestBranchKey = (branch: Pick<PullRequestBranch, 'repoFullName' | 'branch'>) =>
	`${branch.repoFullName}:${branch.branch}`

/** The panel a section reports into: one per session page or task page. */
export const pullRequestScopeKey = (scope: PullRequestScope): string =>
	'sessionId' in scope ? `session:${scope.sessionId}` : `task:${scope.taskId}`

/**
 * The recorded pull request stands in wherever the stream has nothing yet: before its catch-up
 * read lands, after the stream server lost it, and while the server cannot be reached at all.
 * A ready stream that reports no pull request for the branch is GitHub's own answer, so it wins
 * over the record: nothing deletes a record, and a deleted pull request must stop showing.
 *
 * `recorded` is reserved for the stream having given up, because it is what the panel says out
 * loud. A stream still reading stays `hydrating` and shows the record meanwhile, so the ordinary
 * first second of every panel does not accuse the stream of being down.
 */
export const withRecordedPullRequest = (
	prStatus: PrStatusStreamResult,
	listed: PullRequestBranch,
): PrStatusStreamResult => {
	if (prStatus.status === 'permission_required') return prStatus
	// The branch the tab listed names the section even when the stream never answered.
	const located: PrStatusStreamResult = {
		...prStatus,
		repoFullName: prStatus.repoFullName ?? listed.repoFullName,
		branch: prStatus.branch ?? listed.branch,
	}
	if (listed.pullRequest === null) return located
	if (located.status === 'ready' && !located.hasPullRequest) return located
	if (located.pullRequest !== null) return located
	return {
		...located,
		available: true,
		status: recordedStatusFor(located.status),
		pullRequest: listed.pullRequest,
		hasPullRequest: true,
	}
}

const recordedStatusFor = (status: PrStatusStreamResult['status']): PrStatusStreamResult['status'] => {
	if (status === 'ready') return 'ready'
	return status === 'unavailable' ? 'recorded' : 'hydrating'
}

/**
 * The branch's earlier pull requests under the one the panel shows. The panel's own is left out
 * whichever answer, stream or record, is ahead, and an open one is never earlier: it is the next
 * round, and the stream shows it as soon as it catches up.
 */
export const earlierPullRequestsOf = (
	listed: PullRequestBranch,
	shown: Pick<PullRequestRowType, 'number'> | null,
): PanelPullRequest[] => {
	const earlier = listed.earlierPullRequests ?? []
	const recorded = shown && listed.pullRequest ? [listed.pullRequest, ...earlier] : earlier
	const byNumber = new Map(recorded.map((pullRequest) => [pullRequest.number, pullRequest]))
	if (shown) byNumber.delete(shown.number)
	return [...byNumber.values()]
		.filter((pullRequest) => pullRequest.state !== 'open')
		.sort((left, right) => right.number - left.number)
}
