import { useQuery } from '@tanstack/react-query'

import { useRiptideApi } from '@/orpc/client'

/** Wait for the prompt to settle before asking the model for a task title. */
export const TITLE_GENERATION_DEBOUNCE_MS = 3_000

/**
 * Handles debounced AI title generation for structured mode.
 * Returns generated title — the parent derives form display values from it.
 */
export function useTitleAutoGenerate({
	watchedMode,
	debouncedDescription,
	nameManuallyEdited,
}: {
	watchedMode: string
	debouncedDescription: string | undefined
	nameManuallyEdited: boolean
}) {
	const { queryClient: api } = useRiptideApi()
	const trimmedDescription = debouncedDescription?.trim() ?? ''

	const titleQuery = useQuery({
		...api.ai.generateTitle.queryOptions({
			input: { text: trimmedDescription },
			context: { silent: true },
		}),
		enabled: watchedMode === 'structured' && trimmedDescription.length >= 10 && !nameManuallyEdited,
	})

	return {
		isGeneratingTitle: titleQuery.isFetching,
		generatedTitle: titleQuery.data?.title ?? null,
	}
}
