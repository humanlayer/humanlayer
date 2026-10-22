import { useQuery } from '@tanstack/react-query'

import { useRiptideApi } from '@/api/client'

/**
 * The scatter's model / agent / repo dropdown options.
 *
 * Takes NO range, so it is fetched once per page load and dragging the brush
 * never refetches it. That is both cheaper — these are three DISTINCT/UNION
 * scans that used to re-run on every range change, and a filtered scatter had
 * to make a second unfiltered request just to get them — and more correct: a
 * range-bounded option list shrinks as you drag, so a filter you had selected
 * could disappear from its own dropdown while staying applied.
 */
export function useScatterFilterOptions() {
	const { queryClient } = useRiptideApi()

	const timezoneOffset = new Date().getTimezoneOffset()

	return useQuery(
		queryClient.metrics.scatterFilterOptions.queryOptions({
			input: { timezoneOffset },
		}),
	)
}
