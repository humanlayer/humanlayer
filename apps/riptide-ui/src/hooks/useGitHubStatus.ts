import type { GetGitHubStatusOutput } from '@humanlayer/riptide-api-contract/api/integrations/github/get-status'
import { useQuery } from '@tanstack/react-query'

import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { useRiptideApi } from '@/orpc/client'

export type { GitHubStatus } from '@humanlayer/riptide-api-contract/api/integrations/github/get-status'

/**
 * The one value every GitHub surface branches on. Null while the answer is not in: the query has
 * not landed, it failed, the GitHub tab experiment is off for this reader, or this deployment has
 * no GitHub app. Nothing GitHub-shaped
 * renders on null, so a surface cannot ask for a connection it cannot judge.
 */
export function useGitHubStatus(): GetGitHubStatusOutput | null {
	const panelEnabled = useSettingsStore((state) => state.githubPrPanelEnabled)
	const githubConfigured = useSettingsStore((state) => state.githubConfigured)
	// Skip the call when this deployment has no GitHub keys; the server would only refuse it.
	const enabled = panelEnabled && githubConfigured
	const { queryClient } = useRiptideApi()
	const { data } = useQuery({
		...queryClient.integrations.github.getStatus.queryOptions({ input: {}, context: { silent: true } }),
		enabled,
		retry: false,
		staleTime: 60_000,
		refetchOnWindowFocus: true,
	})
	return enabled ? (data ?? null) : null
}
