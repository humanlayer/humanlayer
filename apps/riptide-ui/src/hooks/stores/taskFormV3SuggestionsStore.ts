import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'

export const TASK_FORM_V3_SUGGESTIONS_STORAGE_KEY = 'taskFormV3Suggestions'

interface TaskFormV3SuggestionsState {
	dismissedSuggestionIds: string[]
	dismissSuggestion: (suggestionId: string) => void
}

const noopStorage: StateStorage = {
	getItem: () => null,
	setItem: () => {},
	removeItem: () => {},
}

export const useTaskFormV3SuggestionsStore = create<TaskFormV3SuggestionsState>()(
	persist(
		(set) => ({
			dismissedSuggestionIds: [],
			dismissSuggestion: (suggestionId) =>
				set((state) => {
					if (state.dismissedSuggestionIds.includes(suggestionId)) return state
					return { dismissedSuggestionIds: [...state.dismissedSuggestionIds, suggestionId] }
				}),
		}),
		{
			name: TASK_FORM_V3_SUGGESTIONS_STORAGE_KEY,
			storage: createJSONStorage(() => (typeof localStorage === 'undefined' ? noopStorage : localStorage)),
			partialize: (state) => ({ dismissedSuggestionIds: state.dismissedSuggestionIds }),
		},
	),
)
