import { beforeEach, describe, expect, test } from 'vitest'

import { countGitHubPanelFailingChecks, githubPanelSectionKey, useGitHubPanelStore } from './githubPanelStore'

const store = useGitHubPanelStore

describe('githubPanelStore', () => {
	beforeEach(() => store.setState({ sections: {}, attention: {} }))

	test('holds one attention per scope and clears it without touching the others', () => {
		store.getState().setAttention('s1', 'warning')
		store.getState().setAttention('s2', 'accent')

		expect(store.getState().attention).toEqual({ s1: 'warning', s2: 'accent' })

		store.getState().clearAttention('s1')

		expect(store.getState().attention).toEqual({ s2: 'accent' })
	})

	test('keeps the same state object when attention repeats or an unknown scope is cleared', () => {
		store.getState().setAttention('s1', 'warning')
		const before = store.getState().attention

		store.getState().setAttention('s1', 'warning')
		store.getState().clearAttention('s3')

		expect(store.getState().attention).toBe(before)
	})

	test('sums the failing checks of one scope only', () => {
		store.getState().report(githubPanelSectionKey('s1', 'app'), 2)
		store.getState().report(githubPanelSectionKey('s1', 'sdk'), 0)
		store.getState().report(githubPanelSectionKey('s2', 'app'), 5)

		expect(countGitHubPanelFailingChecks(store.getState().sections, 's1')).toBe(2)
		expect(countGitHubPanelFailingChecks(store.getState().sections, 's3')).toBe(0)
	})

	test('keeps the same state object when a report repeats, so subscribers do not re-render', () => {
		const key = githubPanelSectionKey('s1', 'app')
		store.getState().report(key, 1)
		const before = store.getState().sections

		store.getState().report(key, 1)

		expect(store.getState().sections).toBe(before)
	})

	test('forgets a section and ignores a repeat', () => {
		const key = githubPanelSectionKey('s1', 'app')
		store.getState().report(key, 1)

		store.getState().forget(key)
		const after = store.getState().sections
		store.getState().forget(key)

		expect(after).toEqual({})
		expect(store.getState().sections).toBe(after)
		expect(countGitHubPanelFailingChecks(after, 's1')).toBe(0)
	})
})
