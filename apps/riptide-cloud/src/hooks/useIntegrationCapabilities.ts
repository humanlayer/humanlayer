import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@workos-inc/authkit-react'

import { useRiptideApi } from '@/api/client'
import { type CapabilitiesState, capabilitiesStateFromQuery } from '@/lib/integration-capabilities'

/**
 * What this deployment supports. The server fixes these answers at startup, so the query is
 * fetched once and kept for the session: it never goes stale, is never collected, and does not
 * retry, since a failure falls back to the behavior from before capabilities existed.
 */
export function useIntegrationCapabilities(options: { readonly enabled?: boolean } = {}): CapabilitiesState {
	const { queryClient: api } = useRiptideApi()
	const { organizationId } = useAuth()
	const query = useQuery(
		api.integrations.getCapabilities.queryOptions({
			input: {},
			enabled: (options.enabled ?? true) && Boolean(organizationId),
			staleTime: Number.POSITIVE_INFINITY,
			gcTime: Number.POSITIVE_INFINITY,
			retry: false,
		}),
	)
	return capabilitiesStateFromQuery(query)
}
