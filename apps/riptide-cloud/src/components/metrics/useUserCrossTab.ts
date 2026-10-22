import { useQuery } from '@tanstack/react-query'

import { useRiptideApi } from '@/api/client'

import type { MetricsRange } from './range'

/**
 * The two per-person cross-tabs. Both take the page range and, like their
 * ranked siblings, no filters — the card IS the breakdown.
 *
 * They pass `bucket` even though neither has a bucket dimension: it keeps the
 * cache key aligned with every other card on the page, so a range change never
 * leaves one card showing a window another has already left.
 */
export function useUserStageSpend(range: MetricsRange) {
	const { queryClient } = useRiptideApi()
	const timezoneOffset = new Date().getTimezoneOffset()
	return useQuery(queryClient.metrics.userStageSpend.queryOptions({ input: { ...range, timezoneOffset } }))
}

export function useUserModeSpend(range: MetricsRange) {
	const { queryClient } = useRiptideApi()
	const timezoneOffset = new Date().getTimezoneOffset()
	return useQuery(queryClient.metrics.userModeSpend.queryOptions({ input: { ...range, timezoneOffset } }))
}
