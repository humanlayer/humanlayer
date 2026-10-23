import { useQuery } from '@tanstack/react-query'

import { useRiptideApi } from '@/api/client'

import type { ScatterFilters } from './filters'
import type { MetricsRange } from './range'

/**
 * Per-user cost/LOC/commit/PR aggregates backing the lens KPI cards and the
 * hero scatter. Fetches ONLY the requested range: prefetching adjacent
 * ranges was 14 extra replica queries per load for a switch that still showed
 * four loading cards — and with a brush there is no longer a small, fixed set
 * of ranges worth prefetching. TanStack Query dedupes identical (range,
 * filters) keys, so the KPI row and the scatter share one request.
 *
 * Each `filters` array empty/omitted = no filter on that dimension (matches
 * the API contract: an empty array is sent as `undefined` so the server
 * doesn't filter). Only the scatter passes filters — the KPI cards are
 * ratios, and every available filter narrows just one side of them.
 */
export function useUsersScatter(range: MetricsRange, filters: ScatterFilters = {}) {
	const { queryClient } = useRiptideApi()

	const timezoneOffset = new Date().getTimezoneOffset()
	return useQuery(
		queryClient.metrics.usersScatter.queryOptions({
			input: {
				...range,
				timezoneOffset,
				models: filters.models && filters.models.length > 0 ? filters.models : undefined,
				agents: filters.agents && filters.agents.length > 0 ? filters.agents : undefined,
				repos: filters.repos && filters.repos.length > 0 ? filters.repos : undefined,
			},
		}),
	)
}
