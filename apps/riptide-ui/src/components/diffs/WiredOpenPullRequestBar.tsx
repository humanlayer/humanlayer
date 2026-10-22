import type { PullRequestScope } from '@humanlayer/riptide-api-contract/api/integrations/github/pull-requests/ensure-stream'
import type { PullRequestBranch } from '@humanlayer/riptide-api-contract/api/integrations/github/pull-requests/list-branches'
import { OpenPullRequestBar } from '@humanlayer/ui/components/diff-review/open-pull-request-bar'
import { useQuery } from '@tanstack/react-query'
import type { FC } from 'react'

import type { DiffFeedbackDeliveryTarget } from '@/components/diffs/delivery/use-diff-feedback-delivery'
import { offersOpenPullRequest } from '@/components/github/open-pull-request'
import { githubPanelStateOf } from '@/components/github/panel-state'
import { pullRequestBranchKey, withRecordedPullRequest } from '@/components/github/pull-request-branch'
import { useOpenPullRequestDelivery } from '@/components/github/useOpenPullRequestDelivery'
import { usePrStatusStream } from '@/hooks/session-detail/usePrStatusStream'
import { useOpenPullRequestBarStore } from '@/hooks/stores/openPullRequestBarStore'
import { useConnectIntegrationAction } from '@/hooks/useConnectIntegrationAction'
import { useGitHubStatus } from '@/hooks/useGitHubStatus'
import { useRiptideApi } from '@/orpc/client'

export interface WiredOpenPullRequestBarProps {
	/** Whose diff this is. The scope and the send target both follow from it. */
	target: DiffFeedbackDeliveryTarget
	taskId: string
	/** Unsent review comments are the more urgent action, so the bar goes quiet while any are open. */
	openCommentCount: number
}

const scopeOf = (target: DiffFeedbackDeliveryTarget, taskId: string): PullRequestScope =>
	target.kind === 'session' ? { sessionId: target.sessionId } : { taskId }

/** The session a send goes to; null on a task page, where the prompt is copied instead. */
const deliverySessionIdOf = (target: DiffFeedbackDeliveryTarget): string | null =>
	target.kind === 'session' ? target.sessionId : null

const repoLabelOf = (repoFullName: string): string => repoFullName.split('/').at(-1) ?? repoFullName

const useDismissal = (branch: PullRequestBranch) => {
	const key = pullRequestBranchKey(branch)
	const dismissed = useOpenPullRequestBarStore((state) => state.dismissed[key] === true)
	const dismiss = useOpenPullRequestBarStore((state) => state.dismiss)
	return { dismissed, onDismiss: () => dismiss(key) }
}

/** The bar for a branch the session pushed while the organization has no GitHub installation. */
const WiredConnectGitHubBarRow: FC<{ branch: PullRequestBranch; demoted: boolean }> = ({ branch, demoted }) => {
	const { dismissed, onDismiss } = useDismissal(branch)
	const connect = useConnectIntegrationAction()

	if (dismissed) return null
	return (
		<OpenPullRequestBar
			repoLabel={repoLabelOf(branch.repoFullName)}
			branch={branch.branch}
			kind="connect"
			demoted={demoted}
			onOpen={() => void connect('github')}
			onDismiss={onDismiss}
		/>
	)
}

const WiredOpenPullRequestBarRow: FC<{
	scope: PullRequestScope
	branch: PullRequestBranch
	deliverySessionId: string | null
	demoted: boolean
}> = ({ scope, branch, deliverySessionId, demoted }) => {
	const streamStatus = usePrStatusStream({ scope, repoFullName: branch.repoFullName, branch: branch.branch })
	const prStatus = withRecordedPullRequest(streamStatus, branch)
	const delivery = useOpenPullRequestDelivery(deliverySessionId)
	const { dismissed, onDismiss } = useDismissal(branch)

	if (dismissed) return null
	const offered = offersOpenPullRequest(
		githubPanelStateOf(prStatus.status),
		prStatus.hasPullRequest,
		prStatus.pullRequest,
	)
	// A receipt outlives the offer: the branch still has no pull request the moment after a send.
	if (!offered && !delivery.sent) return null

	return (
		<OpenPullRequestBar
			repoLabel={repoLabelOf(branch.repoFullName)}
			branch={branch.branch}
			kind={delivery.kind}
			pending={delivery.pending}
			sent={delivery.sent}
			error={delivery.error}
			demoted={demoted}
			onOpen={() => delivery.open(null)}
			onDismiss={onDismiss}
		/>
	)
}

const WiredOpenPullRequestBarRows: FC<WiredOpenPullRequestBarProps> = ({ target, taskId, openCommentCount }) => {
	const scope = scopeOf(target, taskId)
	const deliverySessionId = deliverySessionIdOf(target)
	const { queryClient } = useRiptideApi()
	const listBranches = queryClient.integrations.github.pullRequests.listPullRequestBranches.queryOptions({
		input: scope,
		context: { silent: true },
	})
	const { data } = useQuery({
		...listBranches,
		retry: false,
		staleTime: 30_000,
		refetchOnWindowFocus: true,
	})

	const github = useGitHubStatus()
	const currentBranches = (data?.branches ?? []).filter((branch) => branch.isCurrent)
	const demoted = openCommentCount > 0
	if (github === null || github.status === 'disabled') return null
	if (github.status === 'not_connected') {
		// The ask goes to whoever can act on it; a member gets the tab's explanation instead.
		if (!github.isAdmin) return null
		return (
			<>
				{currentBranches.map((branch) => (
					<WiredConnectGitHubBarRow key={pullRequestBranchKey(branch)} branch={branch} demoted={demoted} />
				))}
			</>
		)
	}
	return (
		<>
			{currentBranches
				.filter((branch) => branch.installed !== false)
				.map((branch) => (
					<WiredOpenPullRequestBarRow
						key={pullRequestBranchKey(branch)}
						scope={scope}
						branch={branch}
						deliverySessionId={deliverySessionId}
						demoted={demoted}
					/>
				))}
		</>
	)
}

/**
 * One bar per branch the diff's task is checked out on that has no pull request. Only the current
 * branches: the rest of the task's are history, and a diff on screen is the work of the branch the
 * session holds now. `useGitHubStatus` answers null for a reader without the GitHub tab, so the
 * branch query is the only cost they pay.
 */
export const WiredOpenPullRequestBar: FC<WiredOpenPullRequestBarProps> = (props) => {
	const github = useGitHubStatus()
	if (github === null) return null
	return <WiredOpenPullRequestBarRows {...props} />
}
