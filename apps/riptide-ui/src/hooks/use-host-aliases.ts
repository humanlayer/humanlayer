import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { useRiptideApi } from '@/orpc/client'

export function useHostAliases() {
	const { client } = useRiptideApi()

	return useQuery({
		queryKey: ['host-aliases'],
		queryFn: async () => {
			const result = await client.hosts.alias.list({})
			return result.aliases
		},
		refetchInterval: 15_000, // Refresh every 15s
	})
}

export function useUpsertHostAlias() {
	const { client } = useRiptideApi()
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: async (params: { hostId: string; displayName: string }) => {
			return await client.hosts.alias.upsert(params)
		},
		onMutate: async (params) => {
			// Optimistic update
			await queryClient.cancelQueries({ queryKey: ['host-aliases'] })
			const previous = queryClient.getQueryData<Array<{ hostId: string; displayName: string }>>(['host-aliases'])
			queryClient.setQueryData(['host-aliases'], (old: typeof previous) => {
				if (!old) return [{ hostId: params.hostId, displayName: params.displayName }]
				const existing = old.findIndex((a) => a.hostId === params.hostId)
				if (existing >= 0) {
					const updated = [...old]
					updated[existing] = { hostId: params.hostId, displayName: params.displayName }
					return updated
				}
				return [...old, { hostId: params.hostId, displayName: params.displayName }]
			})
			return { previous }
		},
		onError: (_err, _vars, context) => {
			if (context?.previous) {
				queryClient.setQueryData(['host-aliases'], context.previous)
			}
		},
		onSettled: () => {
			void queryClient.invalidateQueries({ queryKey: ['host-aliases'] })
		},
	})
}
