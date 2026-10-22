/**
 * Format search results for AI orchestrator consumption.
 * Uses generic tag names to avoid leaking source information.
 */

export function formatSearchResults(sourceA: string | null, sourceB: string | null): string {
	const resultA = sourceA ?? 'No results from this source.'
	const resultB = sourceB ?? 'No results from this source.'

	return `<search_results_a>
${resultA}
</search_results_a>

<search_results_b>
${resultB}
</search_results_b>`
}
