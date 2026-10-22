import { useMutation, useQueryClient } from '@tanstack/react-query'

import { logger } from '@/lib/logger'
import { useRiptideApi } from '@/orpc/client'

export function getDeleteHostErrorDescription(error: unknown): string {
	const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
	switch (code) {
		case 'BAD_REQUEST':
			return 'The host must be offline for at least 15 minutes since its last heartbeat. Check its status before retrying.'
		case 'NOT_FOUND':
			return 'The host is no longer in the list. Refresh the host list before retrying.'
		case 'UNAUTHORIZED':
			return 'Your session has expired. Sign in again before retrying.'
		case 'ORGANIZATION_REQUIRED':
			return 'Select an organization before retrying.'
		case 'FORBIDDEN':
			return "You don't have permission to delete this host. Only its owner can delete it."
		case 'BILLING_REQUIRED':
		case 'UPGRADE_REQUIRED':
			return 'Billing must be updated before you can delete a host. Ask an organization admin.'
		default:
			return 'Deletion could not be confirmed. Check the host list before retrying.'
	}
}

export function useDeleteHost() {
	const { client } = useRiptideApi()
	const queryClient = useQueryClient()

	return useMutation({
		// An uncertain transport response is not safe to retry automatically.
		retry: false,
		// The settings surface owns error copy, including expected stale-target rejections.
		mutationFn: (params: { hostId: string }) => client.hosts.delete(params, { context: { silent: true } }),
		onSettled: async () => {
			// Refresh stale targets on rejection too. Cache failures must never turn a committed
			// deletion into a mutation error (or mask the original RPC rejection).
			const results = await Promise.allSettled([
				queryClient.invalidateQueries({ queryKey: ['sync', 'onlineHosts'] }),
				queryClient.invalidateQueries({ queryKey: ['host-aliases'] }),
			])
			for (const result of results) {
				if (result.status === 'rejected')
					logger.warn('Could not refresh host caches after deletion', result.reason)
			}
		},
	})
}
