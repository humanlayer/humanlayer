import type { PullRequestBranch } from '@humanlayer/riptide-api-contract/api/integrations/github/pull-requests/list-branches'
import { useQuery } from '@tanstack/react-query'
import type { FC } from 'react'

import { useBrowserAuth } from '@/hooks/use-browser-auth'
import { useConnectIntegrationAction } from '@/hooks/useConnectIntegrationAction'
import { useRiptideApi } from '@/orpc/client'

import { GitHubConnectSkeleton } from './GitHubConnectSkeleton'

/** The organization the session belongs to, from the list the auth provider already holds. */
const useActiveOrganizationName = (): string | null => {
	const { organizationId } = useBrowserAuth()
	const { queryClient } = useRiptideApi()
	const { data } = useQuery(
		queryClient.auth.user.organizations.list.queryOptions({
			context: { silent: true },
			enabled: !!organizationId,
			staleTime: 30_000,
		}),
	)
	return data?.organizations?.find((org) => org.organizationId === organizationId)?.organizationName ?? null
}

export const WiredGitHubConnectSkeleton: FC<{ branch: PullRequestBranch; isAdmin: boolean }> = ({
	branch,
	isAdmin,
}) => {
	const connect = useConnectIntegrationAction()
	const orgName = useActiveOrganizationName()
	return (
		<GitHubConnectSkeleton
			repoFullName={branch.repoFullName}
			branch={branch.branch}
			isAdmin={isAdmin}
			orgName={orgName}
			onConnect={() => void connect('github')}
		/>
	)
}
