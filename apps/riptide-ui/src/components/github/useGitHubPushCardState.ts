import type { GitHubPushCardState } from '@humanlayer/ui/components/conversation-stream'
import { useQuery } from '@tanstack/react-query'

import { useGitHubPushCardStore } from '@/hooks/stores/githubPushCardStore'
import { useGitHubStatus } from '@/hooks/useGitHubStatus'
import { useRiptideApi } from '@/orpc/client'

export interface GitHubPushCardInput {
	sessionId: string
	/** The push tool call the card sits under; Later and the GitHub tab are remembered per push. */
	toolCallId: string
}

/**
 * What the card under a push says, or null when it says nothing: before the server lists the
 * session's branches, when the checkout is not on any of them, when the connect ask was waved
 * away, after the pull request card has had its one showing, and while a connected
 * branch has no pull request yet (the diff's own bar covers that).
 */
export function useGitHubPushCardState({ sessionId, toolCallId }: GitHubPushCardInput): GitHubPushCardState | null {
	const { queryClient } = useRiptideApi()
	const github = useGitHubStatus()
	const dismissed = useGitHubPushCardStore((state) => state.dismissed[sessionId] === true)
	const noticeOver = useGitHubPushCardStore(
		(state) => state.taken[toolCallId] === true || state.seen[toolCallId] === true,
	)
	const listBranches = queryClient.integrations.github.pullRequests.listPullRequestBranches.queryOptions({
		input: { sessionId },
		context: { silent: true },
	})
	const { data } = useQuery({
		...listBranches,
		enabled: github !== null,
		retry: false,
		staleTime: 30_000,
		refetchOnWindowFocus: true,
	})
	const branch = data?.branches.find((candidate) => candidate.isCurrent)
	if (!branch || github === null) return null
	if (github.status === 'not_connected') {
		// The ask goes to whoever can act on it; a member gets the GitHub tab's explanation instead.
		if (dismissed || !github.isAdmin) return null
		return { kind: 'not_connected', branch: branch.branch, repoFullName: branch.repoFullName }
	}
	if (github.status === 'connected' && branch.pullRequest && !noticeOver) {
		return {
			kind: 'pull_request',
			branch: branch.branch,
			number: branch.pullRequest.number,
			isDraft: branch.pullRequest.isDraft,
			checkCount: null,
		}
	}
	return null
}
