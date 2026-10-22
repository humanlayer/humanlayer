import { useQuery } from '@tanstack/react-query'

import { useRiptideApi } from '@/api/client'

import type { MetricsRange } from './range'

/**
 * Tasks bucketed by how far the work fanned out — contributors, coding agents
 * and models per task. Counts only; the endpoint returns no user identity.
 */
export function useTaskFanOut(range: MetricsRange, enabled = true) {
	const { queryClient } = useRiptideApi()

	const timezoneOffset = new Date().getTimezoneOffset()

	return useQuery(
		queryClient.metrics.taskFanOut.queryOptions({
			input: { ...range, timezoneOffset },
			// The card mounts both lenses' hooks but shows one. Without this the
			// hidden lens still queries, doubling the load the page puts on the
			// read replica for a result nothing renders.
			enabled,
		}),
	)
}
