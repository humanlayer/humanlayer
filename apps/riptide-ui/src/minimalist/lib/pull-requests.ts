import { useQuery } from '@tanstack/react-query'

import type { CheckGroups } from '@/components/github/check-groups'
import { useRiptideApi } from '@/orpc/client'

type RiptideQueryClient = ReturnType<typeof useRiptideApi>['queryClient']

/** The task's branches and their PRs. The panel and the PR inbox share one cache entry per task. */
export function pullRequestBranchesQuery(orpc: RiptideQueryClient, taskId: string) {
	return {
		...orpc.integrations.github.pullRequests.listPullRequestBranches.queryOptions({
			input: { taskId },
			context: { silent: true },
		}),
		retry: false,
		staleTime: 30_000,
	}
}

/**
 * The branch the task's PR lives on: the current branch with a PR first, then any branch with one.
 * `failed` means GitHub couldn't be asked, which is not the same as no PR; `retry` asks again.
 */
export function useTaskPullRequest(taskId: string) {
	const { queryClient } = useRiptideApi()
	const { data, isLoading, isError, isFetching, refetch } = useQuery({
		...pullRequestBranchesQuery(queryClient, taskId),
		refetchOnWindowFocus: true,
	})
	const branches = (data?.branches ?? []).filter((branch) => branch.installed)
	const withPr = branches.filter((branch) => branch.pullRequest)
	const branch =
		withPr.find((entry) => entry.isCurrent) ?? withPr[0] ?? branches.find((entry) => entry.isCurrent) ?? null
	return { branch, isLoading, failed: isError && !data, retrying: isFetching, retry: () => void refetch() }
}

export type PullRequestBadge = { label: string; tone: 'add' | 'del' | 'muted' }

/**
 * The one thing worth knowing about a PR at a glance, most urgent first:
 * closed or merged, then failing checks, running checks, requested changes, draft, approval, passing checks.
 */
export function pullRequestBadge(
	pr: { state: string; isDraft: boolean; reviewDecision?: string | null },
	checks: Pick<CheckGroups, 'failed' | 'running' | 'passed'>,
): PullRequestBadge {
	if (pr.state === 'merged') return { label: 'Merged', tone: 'muted' }
	if (pr.state === 'closed') return { label: 'Closed', tone: 'muted' }
	if (checks.failed.length > 0) return { label: `${checks.failed.length} failing`, tone: 'del' }
	if (checks.running.length > 0) return { label: `${checks.running.length} running`, tone: 'muted' }
	if (pr.reviewDecision === 'CHANGES_REQUESTED') return { label: 'Changes requested', tone: 'del' }
	if (pr.isDraft) return { label: 'Draft', tone: 'muted' }
	if (pr.reviewDecision === 'APPROVED') return { label: 'Approved', tone: 'add' }
	if (checks.passed.length > 0) return { label: 'Checks pass', tone: 'add' }
	return { label: 'Open', tone: 'muted' }
}
