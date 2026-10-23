import { useQuery } from '@tanstack/react-query'

import { useRiptideApi } from '@/api/client'

import type { MetricsRange } from './range'

/** Per-bucket spend by workflow mode backing ModeSpendCard. */
export function useModeSpendTrend(range: MetricsRange) {
	const { queryClient } = useRiptideApi()

	const timezoneOffset = new Date().getTimezoneOffset()

	return useQuery(
		queryClient.metrics.modeSpendTrend.queryOptions({
			input: { ...range, timezoneOffset },
		}),
	)
}
