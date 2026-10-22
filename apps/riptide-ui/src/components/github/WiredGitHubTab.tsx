import type { PullRequestScope } from '@humanlayer/riptide-api-contract/api/integrations/github/pull-requests/ensure-stream'
import type { PullRequestBranch } from '@humanlayer/riptide-api-contract/api/integrations/github/pull-requests/list-branches'
import { TabsContent } from '@humanlayer/ui/components/tabs'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { FC, ReactNode } from 'react'

import { useGitHubStatus } from '@/hooks/useGitHubStatus'
import { useRiptideApi } from '@/orpc/client'

import { GitHubOtherBranchesDivider } from './GitHubOtherBranchesDivider'
import { pullRequestBranchKey } from './pull-request-branch'
import { useSessionHostRepositoryReporting } from './useSessionHostRepositoryReporting'
import { WiredDaemonTooOldNotice } from './WiredDaemonTooOldNotice'
import { WiredGitHubConnectPrompt } from './WiredGitHubConnectPrompt'
import { WiredGitHubConnectSkeleton } from './WiredGitHubConnectSkeleton'
import { WiredGitHubRepoSection } from './WiredGitHubRepoSection'
import { WiredGitHubRepositoriesWithoutAppNote } from './WiredGitHubRepositoriesWithoutAppNote'

export interface WiredGitHubTabProps {
	scope: PullRequestScope
	/** Changes when a host's workspace setup does, so a remote that appears after mount is picked up. */
	workspaceRevision: string
	/** The session a send goes to; a task page passes none, having none. */
	deliverySessionId?: string | null
}

/** Nothing is installed, so every listed branch is uninstalled: the ones pushed to get the ask. */
const GitHubConnectContent: FC<{ branches: readonly PullRequestBranch[]; isAdmin: boolean }> = ({
	branches,
	isAdmin,
}) => {
	const pushedBranches = branches.filter((branch) => branch.isCurrent)
	if (pushedBranches.length === 0) return <WiredGitHubConnectPrompt reason="not_connected" isAdmin={isAdmin} />
	return (
		<>
			{pushedBranches.map((branch) => (
				<WiredGitHubConnectSkeleton key={pullRequestBranchKey(branch)} branch={branch} isAdmin={isAdmin} />
			))}
		</>
	)
}

const NoPullRequestYet: FC = () => (
	<div className="flex flex-col gap-1 px-2 py-3 text-xs" data-testid="github-panel-empty">
		<span className="text-foreground">No pull request yet</span>
		<span className="text-muted-foreground">
			A branch this task works on in a connected repository shows up here, with its pull request once one is
			opened.
		</span>
	</div>
)

/**
 * The GitHub tab body: one section per repository and branch the server lists for the scope, the
 * branches the session is on now open over the rest of the task's. Force-mounted so the sections
 * keep reporting into the panel store for the tab badge while the tab is shut.
 */
export const WiredGitHubTab: FC<WiredGitHubTabProps> = ({ scope, workspaceRevision, deliverySessionId = null }) => {
	const { queryClient } = useRiptideApi()
	const github = useGitHubStatus()
	const hostReporting = useSessionHostRepositoryReporting(deliverySessionId)
	const listBranches = queryClient.integrations.github.pullRequests.listPullRequestBranches.queryOptions({
		input: scope,
		context: { silent: true },
	})
	const { data } = useQuery({
		...listBranches,
		queryKey: [...listBranches.queryKey, workspaceRevision],
		placeholderData: keepPreviousData,
		retry: false,
		staleTime: 30_000,
		refetchOnWindowFocus: true,
	})
	const listed = data?.branches ?? []
	const branches = listed.filter((branch) => branch.installed !== false)
	const repositoriesWithoutTheApp = [
		...new Set(listed.filter((branch) => !branch.installed).map((branch) => branch.repoFullName)),
	]
	const currentBranches = branches.filter((branch) => branch.isCurrent)
	const otherBranches = branches.filter((branch) => !branch.isCurrent)
	const renderSection = (branch: PullRequestBranch) => (
		<WiredGitHubRepoSection
			key={pullRequestBranchKey(branch)}
			scope={scope}
			branch={branch}
			hideRepoHeader={branches.length === 1}
			preferOpen={branch.isCurrent}
			deliverySessionId={deliverySessionId}
		/>
	)
	let content: ReactNode = null
	if (github?.status === 'disabled') {
		content = <WiredGitHubConnectPrompt reason={github.status} isAdmin={github.isAdmin} />
	} else if (github?.status === 'not_connected') {
		content = <GitHubConnectContent branches={listed} isAdmin={github.isAdmin} />
	} else if (branches.length > 0) {
		content = (
			<>
				{currentBranches.map(renderSection)}
				{currentBranches.length > 0 && otherBranches.length > 0 ? (
					<GitHubOtherBranchesDivider count={otherBranches.length} />
				) : null}
				{otherBranches.map(renderSection)}
				{repositoriesWithoutTheApp.length > 0 ? (
					<WiredGitHubRepositoriesWithoutAppNote
						repositories={repositoriesWithoutTheApp}
						isAdmin={github?.isAdmin ?? false}
					/>
				) : null}
			</>
		)
	} else if (hostReporting.state === 'cannot_report') {
		content = <WiredDaemonTooOldNotice hostName={hostReporting.hostName} />
	} else if (repositoriesWithoutTheApp.length > 0) {
		content = (
			<WiredGitHubConnectPrompt
				reason="repositories_without_app"
				isAdmin={github?.isAdmin ?? false}
				repositories={repositoriesWithoutTheApp}
			/>
		)
	} else if (data) {
		content = <NoPullRequestYet />
	}

	return (
		<TabsContent
			value="github"
			forceMount
			className="mt-0 min-h-0 flex-1 overflow-hidden data-[state=inactive]:hidden"
		>
			<div className="flex h-full min-h-0 flex-col gap-2 overflow-y-auto" data-testid="github-panel">
				{content}
			</div>
		</TabsContent>
	)
}
