import { useQuery } from '@tanstack/react-query'

import { useRiptideApi } from '@/api/client'

/**
 * Daily spend across the whole strip, plus the boundaries the brush needs.
 *
 * Takes NO range — that is the point. This is the data behind the control that
 * chooses the range, so it must show what lies outside the current selection
 * (a spike you cannot see is a spike you cannot select), and it must not
 * refetch while a handle is moving. One query per page load, reused by every
 * drag.
 */
export function useRangeOverview() {
	const { queryClient } = useRiptideApi()

	const timezoneOffset = new Date().getTimezoneOffset()

	return useQuery(
		queryClient.metrics.rangeOverview.queryOptions({
			input: { timezoneOffset },
		}),
	)
}
