import type { PullRequestScope } from '@humanlayer/riptide-api-contract/api/integrations/github/pull-requests/ensure-stream'
import type { FC } from 'react'

import type { PrStatusStreamResult } from '@/hooks/session-detail/usePrStatusStream'

import { type EarlierPullRequest, EarlierPullRequests } from './EarlierPullRequests'
import { offersOpenPullRequestInPanel } from './open-pull-request'
import { githubPanelStateOf } from './panel-state'
import { SidebarWidgetGitHub } from './SidebarWidgetGitHub'
import type { PrPromptDelivery } from './usePrPromptDelivery'
import { WiredGitHubPermissionPrompt } from './WiredGitHubPermissionPrompt'
import { WiredOpenPullRequestRow } from './WiredOpenPullRequestRow'
import { WiredPullRequestMergeRow } from './WiredPullRequestMergeRow'

export const SessionGitHubPanel: FC<{
	scope: PullRequestScope
	prStatus: PrStatusStreamResult
	delivery: PrPromptDelivery | null
	deliverySessionId: string | null
	earlierPullRequests: readonly EarlierPullRequest[]
}> = ({ scope, prStatus, delivery, deliverySessionId, earlierPullRequests }) => {
	if (prStatus.status === 'permission_required') return <WiredGitHubPermissionPrompt />
	const { pullRequest, repoFullName, branch } = prStatus
	const state = githubPanelStateOf(prStatus.status)
	return (
		<SidebarWidgetGitHub
			pullRequest={pullRequest}
			branch={branch}
			hasPullRequest={prStatus.hasPullRequest}
			checks={prStatus.checks}
			state={state}
			staleSince={prStatus.staleSince}
			delivery={delivery}
		>
			{/* The two ends of a branch's life share the bottom slot: the one control that can open
			    a pull request, then the one that can land it. Never both. */}
			{offersOpenPullRequestInPanel(state, prStatus.hasPullRequest, pullRequest) ? (
				<WiredOpenPullRequestRow sessionId={deliverySessionId} />
			) : null}
			{/* A row from a delivery, or recorded before the panel query first ran, has no merge
			    state yet; the row waits for the next query rather than offering a button it cannot
			    judge. It needs live checks to judge one, so the record alone never earns a row. */}
			{state === 'live' && pullRequest?.merge && repoFullName && branch ? (
				<WiredPullRequestMergeRow
					scope={scope}
					repoFullName={repoFullName}
					branch={branch}
					pullRequest={pullRequest}
					merge={pullRequest.merge}
					checks={prStatus.checks}
				/>
			) : null}
			<EarlierPullRequests pullRequests={earlierPullRequests} />
		</SidebarWidgetGitHub>
	)
}
