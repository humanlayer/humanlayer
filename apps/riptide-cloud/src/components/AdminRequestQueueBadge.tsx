import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@workos-inc/authkit-react'

import { useRiptideApi } from '@/api/client'

export function AdminRequestQueueBadge() {
	const { roles } = useAuth()
	const isAdmin = roles?.includes('admin')
	const { queryClient: apiQueryClient } = useRiptideApi()

	const { data } = useQuery(
		apiQueryClient.auth.admin.accessRequests.unreadCount.queryOptions({
			input: {},
			enabled: isAdmin ?? false,
			refetchInterval: 60_000,
			refetchOnWindowFocus: true,
		}),
	)

	if (!isAdmin || !data?.count) return null

	return (
		<span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center border border-[#f38ba8] bg-[rgba(243,139,168,0.2)] px-1 text-[11px] text-[#f38ba8]">
			{data.count}
		</span>
	)
}
