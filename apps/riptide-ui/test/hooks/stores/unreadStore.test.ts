import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { useUnreadStore } from '../../../src/hooks/stores/unreadStore'

/**
 * Tests for unreadStore semantics.
 *
 * Covers:
 * - Basic markUnread / isUnread / markRead lifecycle
 * - Idempotent markUnread (same id twice)
 * - markRead on a not-marked id is a no-op
 * - clear wipes the set
 * - Independent ids do not interfere
 * - Set identity changes on mutation (so React subscribers re-render)
 */
describe('unreadStore', () => {
	beforeEach(() => {
		useUnreadStore.getState().clear()
	})
	afterEach(() => {
		useUnreadStore.getState().clear()
	})

	test('markUnread inserts a single id', () => {
		const { markUnread } = useUnreadStore.getState()
		markUnread('session-1')
		expect(useUnreadStore.getState().unreadSessionIds.has('session-1')).toBe(true)
		expect(useUnreadStore.getState().unreadSessionIds.size).toBe(1)
	})

	test('isUnread reflects current state', () => {
		const store = useUnreadStore.getState()
		expect(store.isUnread('session-1')).toBe(false)
		store.markUnread('session-1')
		expect(useUnreadStore.getState().isUnread('session-1')).toBe(true)
	})

	test('markUnread is idempotent (same id twice yields one entry)', () => {
		const store = useUnreadStore.getState()
		store.markUnread('session-1')
		store.markUnread('session-1')
		expect(useUnreadStore.getState().unreadSessionIds.size).toBe(1)
	})

	test('markRead removes the id', () => {
		const store = useUnreadStore.getState()
		store.markUnread('session-1')
		store.markRead('session-1')
		expect(useUnreadStore.getState().isUnread('session-1')).toBe(false)
	})

	test('markRead on unknown id is a no-op', () => {
		const store = useUnreadStore.getState()
		store.markUnread('session-1')
		store.markRead('non-existent')
		const state = useUnreadStore.getState()
		expect(state.unreadSessionIds.size).toBe(1)
		expect(state.isUnread('session-1')).toBe(true)
	})

	test('id can be re-marked unread after markRead (re-fire on repeated transitions)', () => {
		const store = useUnreadStore.getState()
		store.markUnread('session-1')
		store.markRead('session-1')
		store.markUnread('session-1')
		expect(useUnreadStore.getState().isUnread('session-1')).toBe(true)
	})

	test('multiple distinct ids each get their own entry', () => {
		const store = useUnreadStore.getState()
		store.markUnread('session-a')
		store.markUnread('session-b')
		store.markUnread('session-c')
		const state = useUnreadStore.getState()
		expect(state.unreadSessionIds.size).toBe(3)
		expect(state.isUnread('session-a')).toBe(true)
		expect(state.isUnread('session-b')).toBe(true)
		expect(state.isUnread('session-c')).toBe(true)
	})

	test('clear empties the set', () => {
		const store = useUnreadStore.getState()
		store.markUnread('session-1')
		store.markUnread('session-2')
		store.clear()
		expect(useUnreadStore.getState().unreadSessionIds.size).toBe(0)
	})

	test('Set identity changes on each mutation (so React subscribers re-render)', () => {
		const store = useUnreadStore.getState()
		const before = useUnreadStore.getState().unreadSessionIds
		store.markUnread('session-1')
		const after = useUnreadStore.getState().unreadSessionIds
		expect(before).not.toBe(after)
	})
})
