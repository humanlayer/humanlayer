import { useQuery } from '@tanstack/react-query'

import { useBrowserAuth } from '@/hooks/use-browser-auth'
import { useRiptideApi } from '@/orpc/client'

export function usePendingAccessRequestCount() {
	const { isLoading, roles } = useBrowserAuth()
	const { queryClient: api, authScope } = useRiptideApi()
	const isAdmin = roles?.includes('admin') ?? false
	const options = api.auth.admin.accessRequests.unreadCount.queryOptions({ input: {} })
	return useQuery({
		...options,
		queryKey: [...options.queryKey, authScope],
		enabled: !isLoading && isAdmin && Boolean(authScope.userId && authScope.organizationId),
		refetchInterval: 60_000,
		refetchOnWindowFocus: true,
	})
}
