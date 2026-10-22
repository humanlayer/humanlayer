import type { PullRequestScope } from '@humanlayer/riptide-api-contract/api/integrations/github/pull-requests/ensure-stream'
import type { PullRequestBranch } from '@humanlayer/riptide-api-contract/api/integrations/github/pull-requests/list-branches'
import type { CheckRowType } from '@humanlayer/streams/pr-status'
import { type FC, useState } from 'react'

import { usePrStatusStream } from '@/hooks/session-detail/usePrStatusStream'
import { githubPanelSectionKey, useReportGitHubPanelSection } from '@/hooks/stores/githubPanelStore'

import { GitHubRepoSection } from './GitHubRepoSection'
import {
	earlierPullRequestsOf,
	pullRequestBranchKey,
	pullRequestScopeKey,
	withRecordedPullRequest,
} from './pull-request-branch'
import { SessionGitHubPanel } from './SessionGitHubPanel'
import { SidebarWidgetGitHub } from './SidebarWidgetGitHub'
import { usePrPromptDelivery } from './usePrPromptDelivery'

export interface WiredGitHubRepoSectionProps {
	scope: PullRequestScope
	branch: PullRequestBranch
	hideRepoHeader: boolean
	/** How the tab's branch list wants the section to start: open for the session's current branches only. */
	preferOpen: boolean
	/** The session a send goes to; null on a task page, which has none. */
	deliverySessionId: string | null
}

const NO_CHECKS: CheckRowType[] = []

interface RepoSectionVariantProps {
	scope: PullRequestScope
	branch: PullRequestBranch
	onOpenChange: (open: boolean) => void
}

const WiredStreamedGitHubRepoSection: FC<
	RepoSectionVariantProps & { hideRepoHeader: boolean; deliverySessionId: string | null }
> = ({ scope, branch, hideRepoHeader, deliverySessionId, onOpenChange }) => {
	const streamStatus = usePrStatusStream({
		scope,
		repoFullName: branch.repoFullName,
		branch: branch.branch,
	})
	const prStatus = withRecordedPullRequest(streamStatus, branch)
	useReportGitHubPanelSection(githubPanelSectionKey(pullRequestScopeKey(scope), pullRequestBranchKey(branch)), {
		available: prStatus.available,
		failingCheckCount: prStatus.failingCheckCount,
	})
	const delivery = usePrPromptDelivery({
		sessionId: deliverySessionId,
		pullRequest: prStatus.pullRequest,
		checks: prStatus.checks,
	})

	// No early return on `available`: a branch the tab listed keeps its section and says what it
	// knows. Removing a section already on screen reads as the branch having gone away.
	const panel = (
		<SessionGitHubPanel
			scope={scope}
			prStatus={prStatus}
			delivery={delivery}
			deliverySessionId={deliverySessionId}
			earlierPullRequests={earlierPullRequestsOf(branch, prStatus.pullRequest)}
		/>
	)
	if (hideRepoHeader) return panel

	return (
		<GitHubRepoSection
			name={branch.repoFullName}
			branch={branch.branch}
			isCurrent={branch.isCurrent}
			failingCheckCount={prStatus.failingCheckCount}
			pullRequest={prStatus.pullRequest}
			open
			onOpenChange={onOpenChange}
		>
			{panel}
		</GitHubRepoSection>
	)
}

/** A shut section costs no stream: it renders the pull request the server recorded for the branch. */
const WiredRecordedGitHubRepoSection: FC<RepoSectionVariantProps> = ({ scope, branch, onOpenChange }) => {
	useReportGitHubPanelSection(githubPanelSectionKey(pullRequestScopeKey(scope), pullRequestBranchKey(branch)), {
		available: true,
		failingCheckCount: 0,
	})

	return (
		<GitHubRepoSection
			name={branch.repoFullName}
			branch={branch.branch}
			isCurrent={branch.isCurrent}
			failingCheckCount={0}
			pullRequest={branch.pullRequest}
			open={false}
			onOpenChange={onOpenChange}
		>
			<SidebarWidgetGitHub
				pullRequest={branch.pullRequest}
				branch={branch.branch}
				hasPullRequest={branch.pullRequest !== null}
				checks={NO_CHECKS}
				state="recorded"
			/>
		</GitHubRepoSection>
	)
}

export const WiredGitHubRepoSection: FC<WiredGitHubRepoSectionProps> = ({
	scope,
	branch,
	hideRepoHeader,
	preferOpen,
	deliverySessionId,
}) => {
	const [openedByUser, setOpenedByUser] = useState<boolean | null>(null)
	const open = openedByUser ?? preferOpen

	if (hideRepoHeader || open)
		return (
			<WiredStreamedGitHubRepoSection
				scope={scope}
				branch={branch}
				hideRepoHeader={hideRepoHeader}
				deliverySessionId={deliverySessionId}
				onOpenChange={setOpenedByUser}
			/>
		)

	return <WiredRecordedGitHubRepoSection scope={scope} branch={branch} onOpenChange={setOpenedByUser} />
}
