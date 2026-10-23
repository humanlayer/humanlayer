import { describe, expect, test } from 'vitest'

import {
	findNewestStreamEventAlreadyDeliveredBySync,
	shouldHideStreamBlockBecauseNewerSyncRowsRendered,
} from './streamingHandoffSuppression'

describe('streaming handoff suppression', () => {
	test('hides stream-only blocks before a later stream event that also arrived through sync', () => {
		const newestStreamEventAlreadyDeliveredBySync = findNewestStreamEventAlreadyDeliveredBySync(
			[{ conversation_event_id: 'event-b', message_seq: 3, timestamp: 3000 }],
			new Set(['event-b']),
		)

		expect(
			shouldHideStreamBlockBecauseNewerSyncRowsRendered(
				{ conversation_event_id: 'event-a', message_seq: 2, timestamp: 2000 },
				newestStreamEventAlreadyDeliveredBySync,
				new Set(['event-b']),
			),
		).toBe(true)
	})

	test('hides same-turn stream-only blocks using stream timestamps', () => {
		const newestStreamEventAlreadyDeliveredBySync = findNewestStreamEventAlreadyDeliveredBySync(
			[{ conversation_event_id: 'event-b', message_seq: 4, timestamp: 4200 }],
			new Set(['event-b']),
		)

		expect(
			shouldHideStreamBlockBecauseNewerSyncRowsRendered(
				{ conversation_event_id: 'event-a', message_seq: 4, timestamp: 4100 },
				newestStreamEventAlreadyDeliveredBySync,
				new Set(['event-b']),
			),
		).toBe(true)
	})

	test('does not hide the current in-progress tail', () => {
		const newestStreamEventAlreadyDeliveredBySync = findNewestStreamEventAlreadyDeliveredBySync(
			[{ conversation_event_id: 'event-b', message_seq: 4, timestamp: 4200 }],
			new Set(['event-b']),
		)

		expect(
			shouldHideStreamBlockBecauseNewerSyncRowsRendered(
				{ conversation_event_id: 'event-c', message_seq: 5, timestamp: 5000 },
				newestStreamEventAlreadyDeliveredBySync,
				new Set(['event-b']),
			),
		).toBe(false)
	})

	test('does not use sync-only events to hide stream blocks', () => {
		const newestStreamEventAlreadyDeliveredBySync = findNewestStreamEventAlreadyDeliveredBySync(
			[],
			new Set(['event-b']),
		)

		expect(
			shouldHideStreamBlockBecauseNewerSyncRowsRendered(
				{ conversation_event_id: 'event-a', message_seq: 2, timestamp: 2000 },
				newestStreamEventAlreadyDeliveredBySync,
				new Set(['event-b']),
			),
		).toBe(false)
	})

	test('empty or disjoint membership has no boundary, including stream-row IDs instead of saved IDs', () => {
		const event = { id: 'stream-row', conversation_event_id: 'saved-row', message_seq: 1, timestamp: 1 }
		for (const ids of [new Set<string>(), new Set(['unrelated']), new Set(['stream-row'])]) {
			expect(findNewestStreamEventAlreadyDeliveredBySync([event], ids)).toBeNull()
		}
		expect(findNewestStreamEventAlreadyDeliveredBySync([], new Set(['saved-row']))).toBeNull()
		expect(findNewestStreamEventAlreadyDeliveredBySync([event], new Set(['saved-row']))).toBe(event)
	})

	test('selects the newest matching position, not the last array element or newest unsaved event', () => {
		const older = { conversation_event_id: 'older', message_seq: 2, timestamp: 9999 }
		const newestSaved = { conversation_event_id: 'newest-saved', message_seq: 3, timestamp: 1 }
		const unsaved = { conversation_event_id: 'unsaved', message_seq: 4, timestamp: 10000 }
		const ids: ReadonlySet<string> = new Set(['older', 'newest-saved'])
		for (const events of [
			[newestSaved, unsaved, older],
			[older, unsaved, newestSaved],
		]) {
			expect(findNewestStreamEventAlreadyDeliveredBySync(events, ids)).toBe(newestSaved)
		}
	})

	test('breaks equal message/timestamp positions by conversation event ID, never stream row ID', () => {
		const a = { id: 'z-stream', conversation_event_id: 'a', message_seq: 1, timestamp: 100 }
		const b = { id: 'a-stream', conversation_event_id: 'b', message_seq: 1, timestamp: 100 }
		const c = { conversation_event_id: 'c', message_seq: 1, timestamp: 100 }
		for (const events of [
			[a, b],
			[b, a],
		]) {
			expect(findNewestStreamEventAlreadyDeliveredBySync(events, new Set(['a', 'b']))).toBe(b)
		}
		expect(shouldHideStreamBlockBecauseNewerSyncRowsRendered(a, b, new Set(['b']))).toBe(true)
		expect(shouldHideStreamBlockBecauseNewerSyncRowsRendered(c, b, new Set(['b']))).toBe(false)
		// Equal positions are not older, even when the membership passed to this call differs.
		expect(shouldHideStreamBlockBecauseNewerSyncRowsRendered(b, b, new Set())).toBe(false)
	})

	test('reads replacement membership without retaining a boundary after saved deletion', () => {
		const older = { conversation_event_id: 'older', message_seq: 1, timestamp: 1 }
		const newer = { conversation_event_id: 'newer', message_seq: 2, timestamp: 2 }
		const events = [older, newer]
		expect(findNewestStreamEventAlreadyDeliveredBySync(events, new Set(['newer']))).toBe(newer)
		expect(findNewestStreamEventAlreadyDeliveredBySync(events, new Set(['older']))).toBe(older)
		expect(findNewestStreamEventAlreadyDeliveredBySync(events, new Set())).toBeNull()
		// Exact saved membership is handled by the hooks, not the stale-boundary helper.
		expect(shouldHideStreamBlockBecauseNewerSyncRowsRendered(older, newer, new Set(['older']))).toBe(false)
		expect(shouldHideStreamBlockBecauseNewerSyncRowsRendered(older, newer, new Set(['newer']))).toBe(true)
	})

	test('uses only ReadonlySet.has without copying, iterating, or mutating shared membership', () => {
		const membership: ReadonlySet<string> = new Set(['saved'])
		const hasOnly = new Proxy(membership, {
			get(target, property) {
				if (property === 'has') return target.has.bind(target)
				throw new Error(`Unexpected membership access: ${String(property)}`)
			},
		})
		const boundary = { conversation_event_id: 'saved', message_seq: 2, timestamp: 2 }
		expect(findNewestStreamEventAlreadyDeliveredBySync([boundary], hasOnly)).toBe(boundary)
		expect(
			shouldHideStreamBlockBecauseNewerSyncRowsRendered(
				{ conversation_event_id: 'old', message_seq: 1, timestamp: 1 },
				boundary,
				hasOnly,
			),
		).toBe(true)
		expect([...membership]).toEqual(['saved'])
	})
})
