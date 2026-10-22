import { useQuery } from '@tanstack/react-query'

import { useRiptideApi } from '@/api/client'

import type { MetricsRange } from './range'

/**
 * Per-bucket spend plus all three unit-cost denominators backing UnitCostTrendCard.
 * One query serves every lens — the lens division happens client-side in
 * `toTrendRows`, so switching lenses re-plots instantly with no refetch.
 *
 * Takes no filters: the endpoint refuses them wholesale (each would narrow
 * only one side of the ratio; see the contract).
 */
export function useUnitCostTrend(range: MetricsRange) {
	const { queryClient } = useRiptideApi()

	const timezoneOffset = new Date().getTimezoneOffset()

	return useQuery(
		queryClient.metrics.unitCostTrend.queryOptions({
			input: { ...range, timezoneOffset },
		}),
	)
}
