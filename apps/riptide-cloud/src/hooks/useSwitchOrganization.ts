import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@workos-inc/authkit-react'
import { useCallback } from 'react'

/**
 * Switches the active WorkOS organization and clears the React Query cache once
 * the switch completes.
 *
 * oRPC query keys don't include the organization — it's derived from the auth
 * token — so cached data for org A would otherwise be served for org B. Doing
 * the reset here, in the event handler that performs the switch, keeps the
 * side effect tied to the user action that caused it (see the no-useEffect
 * "event handlers, not effects" rule). It also avoids the earlier approach of a
 * reset keyed on organizationId in an effect, which fired on the initial page
 * load and refetched every bootstrap query, doubling all RPCs.
 *
 * The reset is fire-and-forget so switching stays snappy; the refetch it kicks
 * off runs in the background with the new org's token.
 */
export function useSwitchOrganization() {
	const { switchToOrganization } = useAuth()
	const queryClient = useQueryClient()

	return useCallback(
		async (...args: Parameters<typeof switchToOrganization>) => {
			await switchToOrganization(...args)
			void queryClient.resetQueries()
		},
		[switchToOrganization, queryClient],
	)
}
