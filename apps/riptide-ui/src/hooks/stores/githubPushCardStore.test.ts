import { beforeEach, describe, expect, test } from 'vitest'

import { GITHUB_PUSH_CARD_STORAGE_KEY, useGitHubPushCardStore } from './githubPushCardStore'

const store = useGitHubPushCardStore

describe('githubPushCardStore', () => {
	beforeEach(() => {
		store.setState({ dismissed: {} })
		localStorage.removeItem(GITHUB_PUSH_CARD_STORAGE_KEY)
	})

	test('dismisses one push at a time and survives a reload', () => {
		store.getState().dismiss('tool-1')

		expect(store.getState().dismissed).toEqual({ 'tool-1': true })
		expect(JSON.parse(localStorage.getItem(GITHUB_PUSH_CARD_STORAGE_KEY) ?? '{}')).toMatchObject({
			state: { dismissed: { 'tool-1': true } },
		})
	})

	test('keeps the same state object when a dismissal repeats', () => {
		store.getState().dismiss('tool-1')
		const before = store.getState().dismissed

		store.getState().dismiss('tool-1')

		expect(store.getState().dismissed).toBe(before)
	})
})
