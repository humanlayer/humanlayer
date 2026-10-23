import { AccessTokenUnavailableError } from '@humanlayer/sync'
import { useQuery } from '@tanstack/react-query'

export function useSyncAuthReady({
	userId,
	organizationId,
	isAuthLoading,
	getAccessToken,
}: {
	userId: string | null
	organizationId: string | null
	isAuthLoading: boolean
	getAccessToken: () => Promise<string | null>
}): boolean {
	const enabled = !isAuthLoading && userId !== null && organizationId !== null
	const query = useQuery({
		queryKey: ['sync', 'auth-ready', userId, organizationId],
		queryFn: async () => {
			const token = await getAccessToken()
			if (!token) throw new AccessTokenUnavailableError('Access token is not available yet')
			return true
		},
		enabled,
		retry: true,
		retryDelay: (attempt) => Math.min(250 * 2 ** attempt, 2_000),
		staleTime: Infinity,
	})

	return enabled && query.data === true
}
