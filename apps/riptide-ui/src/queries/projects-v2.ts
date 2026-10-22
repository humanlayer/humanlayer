import type { QueryClient } from '@tanstack/react-query'

import type { useRiptideApi } from '@/orpc/client'

export const PROJECTS_V2_QUERY_KEY = ['projects', 'v2'] as const

export function invalidateProjectsV2(queryClient: QueryClient): Promise<void> {
	return queryClient.invalidateQueries({ queryKey: PROJECTS_V2_QUERY_KEY })
}

export function projectsV2ListQuery(api: ReturnType<typeof useRiptideApi>['queryClient']) {
	return {
		...api.projects.v2.list.queryOptions({ input: { archived: false } }),
		queryKey: PROJECTS_V2_QUERY_KEY,
	}
}
