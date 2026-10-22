import { useQuery } from '@tanstack/react-query'

import { useRiptideApi } from '@/api/client'

import type { MetricsRange } from './range'

/**
 * Per-repo HumanLayer commit counts backing AgentCommitsByRepoCard.
 * Takes no filters: the endpoint refuses them (models can't narrow commits at
 * all, and the page scopes agent/repo filters to the scatter).
 */
export function useAgentCommitsByRepo(range: MetricsRange) {
	const { queryClient } = useRiptideApi()

	const timezoneOffset = new Date().getTimezoneOffset()

	return useQuery(
		queryClient.metrics.agentCommitsByRepo.queryOptions({
			input: { ...range, timezoneOffset },
		}),
	)
}
