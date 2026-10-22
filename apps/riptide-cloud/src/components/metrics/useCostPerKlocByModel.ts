import { useQuery } from '@tanstack/react-query'

import { useRiptideApi } from '@/api/client'

import type { MetricsRange } from './range'

/**
 * Per-bucket per-model cost/kLOC cells and coverage backing CostPerKlocByModelCard.
 * Takes no filters: a models filter is moot (the series IS the breakdown),
 * and the page scopes its other filters to the scatter.
 */
export function useCostPerKlocByModel(range: MetricsRange) {
	const { queryClient } = useRiptideApi()

	const timezoneOffset = new Date().getTimezoneOffset()

	return useQuery(
		queryClient.metrics.costPerKlocByModel.queryOptions({
			input: { ...range, timezoneOffset },
		}),
	)
}
