import { beforeEach, describe, expect, test } from 'vitest'

import { DRAFTS_STORAGE_KEY, useDraftsStore } from '../../../src/hooks/stores/draftsStore'

describe('useDraftsStore', () => {
	beforeEach(() => {
		useDraftsStore.setState({ drafts: {} })
	})

	test('setDraft writes per sessionId', () => {
		useDraftsStore.getState().setDraft('s1', { type: 'doc', content: [] })
		useDraftsStore.getState().setDraft('s2', { type: 'doc', content: [] })
		const state = useDraftsStore.getState().drafts
		expect(Object.keys(state).sort()).toEqual(['s1', 's2'])
	})

	test('clearDraft removes only the target sessionId', () => {
		useDraftsStore.getState().setDraft('s1', { type: 'doc', content: [] })
		useDraftsStore.getState().setDraft('s2', { type: 'doc', content: [] })
		useDraftsStore.getState().clearDraft('s1')
		expect(useDraftsStore.getState().drafts).toEqual({ s2: { type: 'doc', content: [] } })
	})

	test('restoreDraft repopulates after clear', () => {
		useDraftsStore.getState().setDraft('s1', { type: 'doc', content: [] })
		useDraftsStore.getState().clearDraft('s1')
		useDraftsStore.getState().restoreDraft('s1', { type: 'doc', content: [{ type: 'text', text: 'restored' }] })
		expect(useDraftsStore.getState().drafts.s1).toEqual({
			type: 'doc',
			content: [{ type: 'text', text: 'restored' }],
		})
	})

	test('persists drafts to localStorage', () => {
		const content = { type: 'doc', content: [{ type: 'text', text: 'survives reauthentication' }] }

		useDraftsStore.getState().setDraft('s1', content)

		expect(JSON.parse(localStorage.getItem(DRAFTS_STORAGE_KEY) ?? '{}')).toEqual({
			state: { drafts: { s1: content } },
			version: 0,
		})
	})

	test('rehydrates persisted drafts', async () => {
		const content = { type: 'doc', content: [{ type: 'text', text: 'restored after reload' }] }
		localStorage.setItem(DRAFTS_STORAGE_KEY, JSON.stringify({ state: { drafts: { s1: content } }, version: 0 }))

		await useDraftsStore.persist.rehydrate()

		expect(useDraftsStore.getState().drafts.s1).toEqual(content)
	})
})
