import { useMutation, useQueryClient } from '@tanstack/react-query'

import { useRiptideApi } from '@/orpc/client'

const ONLINE_HOSTS_SYNC_QUERY_KEY = ['sync', 'onlineHosts'] as const

export function useRequestHostUpdate() {
	const { client } = useRiptideApi()
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: async (params: { hostId: string; version: string }) => client.hosts.update.request(params),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ONLINE_HOSTS_SYNC_QUERY_KEY }),
	})
}
