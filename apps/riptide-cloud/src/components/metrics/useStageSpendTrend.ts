import { useQuery } from '@tanstack/react-query'

import { useRiptideApi } from '@/api/client'

import type { MetricsRange } from './range'

/**
 * Per-bucket spend by RPI stage backing StageSpendCard. Takes no filters: like
 * modelSpendTrend, this chart IS the breakdown, and the page scopes its
 * filters to the scatter.
 */
export function useStageSpendTrend(range: MetricsRange) {
	const { queryClient } = useRiptideApi()

	const timezoneOffset = new Date().getTimezoneOffset()

	return useQuery(
		queryClient.metrics.stageSpendTrend.queryOptions({
			input: { ...range, timezoneOffset },
		}),
	)
}
