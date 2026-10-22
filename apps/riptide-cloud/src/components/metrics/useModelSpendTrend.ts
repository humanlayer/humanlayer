import { useQuery } from '@tanstack/react-query'

import { useRiptideApi } from '@/api/client'

import type { MetricsRange } from './range'

/**
 * Per-bucket spend by model backing ModelSpendCard. Takes no filters: this chart
 * IS the model breakdown, and the page scopes its filters to the scatter.
 */
export function useModelSpendTrend(range: MetricsRange) {
	const { queryClient } = useRiptideApi()

	const timezoneOffset = new Date().getTimezoneOffset()

	return useQuery(
		queryClient.metrics.modelSpendTrend.queryOptions({
			input: { ...range, timezoneOffset },
		}),
	)
}
