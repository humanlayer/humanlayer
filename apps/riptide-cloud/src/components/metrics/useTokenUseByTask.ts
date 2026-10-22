import type { TaskCursor, TokenUseMeasure } from '@humanlayer/riptide-api-contract/api/metrics/tokenUseByTask'
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query'

import { useRiptideApi } from '@/api/client'

import type { MetricsRange } from './range'

/** Spelled out so the optional members can be assigned rather than spread in conditionally. */
type TokenUseInput = MetricsRange & {
	timezoneOffset: number
	measure: TokenUseMeasure
	search?: string
	cursor?: TaskCursor
}

/**
 * The ranked task list behind the card's Tasks lens, paged as the reader
 * scrolls.
 *
 * `measure` and `search` are part of the KEY, not client-side transforms:
 *
 * - the top tasks by tokens and by cost are different populations (agents bill
 *   at very different rates per token), so each measure ranks the whole range
 *   for itself;
 * - filtering the loaded pages would search the rows that happen to be in
 *   memory rather than the range, so a matching task on an unfetched page
 *   would be reported as absent.
 *
 * Changing either therefore starts a fresh list from page one, which is also
 * what a reader expects: re-sorting or re-filtering scrolls back to the top.
 */
export function useTokenUseByTask(range: MetricsRange, measure: TokenUseMeasure, search: string, enabled = true) {
	const { queryClient } = useRiptideApi()

	const timezoneOffset = new Date().getTimezoneOffset()
	// Normalised into the key so " fold" and "fold" are one query, and so an
	// empty box is the same key as no box at all.
	const trimmed = search.trim()

	return useInfiniteQuery(
		queryClient.metrics.tokenUseByTask.infiniteOptions({
			input: (cursor: TaskCursor | undefined) => {
				const input: TokenUseInput = { ...range, timezoneOffset, measure }
				if (trimmed) input.search = trimmed
				if (cursor) input.cursor = cursor
				return input
			},
			initialPageParam: undefined as TaskCursor | undefined,
			// The server returns null once a page comes back short, so the scroll
			// always terminates — the client never has to guess at the end.
			getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
			// Every keystroke in the filter is a new key. Without this the query
			// goes back to pending, the card shell swaps the list for its loading
			// state, and the filter input — which lives inside that list —
			// UNMOUNTS mid-word: focus is lost and every character after the first
			// is typed into nothing. Keeping the previous page on screen while the
			// next one loads keeps the input mounted, and removes a skeleton flash
			// on every letter as a side effect.
			placeholderData: keepPreviousData,
			// The card mounts both lenses' hooks but shows one; the hidden lens
			// must not query for a result nothing renders.
			enabled,
		}),
	)
}
