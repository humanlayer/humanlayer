import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@workos-inc/authkit-react'

import { useRiptideApi } from '@/api/client'

/**
 * Returns the current user's info including the database organization UUID.
 *
 * The WorkOS `organizationId` from `useAuth()` is NOT a UUID — it's a
 * WorkOS-format string like `org_01HXYZ...`.  The database `organization_id`
 * column is a real UUID, and this hook exposes it via the `auth.user.info`
 * endpoint so callers (e.g. optimistic inserts) can use the correct value.
 */
export function useUserInfo() {
	const { queryClient } = useRiptideApi()
	const { organizationId } = useAuth()

	const { data, isLoading } = useQuery({
		...queryClient.auth.user.info.queryOptions({}),
		staleTime: Number.POSITIVE_INFINITY,
		enabled: !!organizationId,
	})

	return {
		dbOrganizationId: data?.organizationId,
		userId: data?.userId,
		// True when the org's billing entitles it to Advanced Metrics: gates the collection toggles
		// and the audience switch in settings, both of which are an admin's to set.
		advancedMetricsAvailable: data?.advancedMetricsAvailable ?? false,
		// True when this viewer may open the page: entitlement plus audience. Server-computed so the
		// client never re-derives who counts as the audience.
		advancedMetricsVisible: data?.advancedMetricsVisible ?? false,
		// Collection flags — Advanced Metrics locks the tabs whose pipeline is off.
		commitTrackingEnabled: data?.commitTrackingEnabled ?? false,
		prTrackingEnabled: data?.prTrackingEnabled ?? false,
		isLoading,
	}
}
