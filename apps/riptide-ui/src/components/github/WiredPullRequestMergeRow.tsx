import type { PullRequestScope } from '@humanlayer/riptide-api-contract/api/integrations/github/pull-requests/ensure-stream'
import type { PullRequestMutation } from '@humanlayer/riptide-api-contract/api/integrations/github/pull-requests/mutate'
import type {
	CheckRowType,
	MergeMethod,
	PullRequestMergeStateType,
	PullRequestRowType,
} from '@humanlayer/streams/pr-status'
import { useMutation } from '@tanstack/react-query'
import { type FC, useState } from 'react'

import { describeGitHubMutationError } from '@/lib/github-panel-error'
import { useRiptideApi } from '@/orpc/client'

import { resolveMergeMethod } from './merge-row'
import { PullRequestMergeRow } from './PullRequestMergeRow'

export interface WiredPullRequestMergeRowProps {
	/** The session or task the panel is open for; the server writes only within it. */
	scope: PullRequestScope
	repoFullName: string
	branch: string
	pullRequest: PullRequestRowType
	merge: PullRequestMergeStateType
	checks: CheckRowType[]
}

/**
 * The merge row on a live pull request: one mutation procedure behind every press. The server
 * writes GitHub's answer to the stream before it responds, so the row re-derives from the row
 * that arrives rather than from anything guessed here.
 */
export const WiredPullRequestMergeRow: FC<WiredPullRequestMergeRowProps> = ({
	scope,
	repoFullName,
	branch,
	pullRequest,
	merge,
	checks,
}) => {
	const { queryClient } = useRiptideApi()
	const [picked, setPicked] = useState<MergeMethod | null>(null)
	const method = resolveMergeMethod(merge, picked)
	const mutation = useMutation(
		queryClient.integrations.github.pullRequests.mutate.mutationOptions({ context: { silent: true } }),
	)

	const mutate = (request: PullRequestMutation) => {
		mutation.mutate({ ...scope, repoFullName, branch, number: pullRequest.number, mutation: request })
	}

	return (
		<PullRequestMergeRow
			pullRequest={pullRequest}
			merge={merge}
			checks={checks}
			method={method}
			onMethodChange={setPicked}
			busy={mutation.isPending ? mutation.variables.mutation.type : null}
			error={mutation.isError ? describeGitHubMutationError(mutation.error) : null}
			onMutate={mutate}
		/>
	)
}
