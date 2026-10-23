import { beforeEach, describe, expect, test } from 'vitest'

import {
	TASK_FORM_V3_SUGGESTIONS_STORAGE_KEY,
	useTaskFormV3SuggestionsStore,
} from '../../../src/hooks/stores/taskFormV3SuggestionsStore'

describe('useTaskFormV3SuggestionsStore', () => {
	beforeEach(() => {
		localStorage.removeItem(TASK_FORM_V3_SUGGESTIONS_STORAGE_KEY)
		useTaskFormV3SuggestionsStore.setState({ dismissedSuggestionIds: [] })
	})

	test('dismisses each suggestion once', () => {
		useTaskFormV3SuggestionsStore.getState().dismissSuggestion('connect-linear')
		useTaskFormV3SuggestionsStore.getState().dismissSuggestion('connect-linear')

		expect(useTaskFormV3SuggestionsStore.getState().dismissedSuggestionIds).toEqual(['connect-linear'])
	})

	test('persists dismissed suggestions to localStorage', () => {
		useTaskFormV3SuggestionsStore.getState().dismissSuggestion('remote-worker')

		expect(JSON.parse(localStorage.getItem(TASK_FORM_V3_SUGGESTIONS_STORAGE_KEY) ?? '{}')).toEqual({
			state: { dismissedSuggestionIds: ['remote-worker'] },
			version: 0,
		})
	})

	test('rehydrates dismissed suggestions', async () => {
		localStorage.setItem(
			TASK_FORM_V3_SUGGESTIONS_STORAGE_KEY,
			JSON.stringify({ state: { dismissedSuggestionIds: ['connect-jira'] }, version: 0 }),
		)

		await useTaskFormV3SuggestionsStore.persist.rehydrate()

		expect(useTaskFormV3SuggestionsStore.getState().dismissedSuggestionIds).toEqual(['connect-jira'])
	})
})
