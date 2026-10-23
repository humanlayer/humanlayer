import type { ConversationEvent } from '@humanlayer/ui/components/conversation-stream'
import { describe, expect, it } from 'vitest'

import { COMPACTED_HISTORY_PAGE_SIZE, getCompactedHistory, revealedHistoryStart } from './compacted-history'

let counter = 0
const event = (overrides: Partial<ConversationEvent>): ConversationEvent => ({
	id: `event-${++counter}`,
	sessionId: 'session',
	eventType: 'message',
	role: 'assistant',
	content: 'hello',
	createdAt: new Date(),
	...overrides,
})
const boundary = (id: string) =>
	event({
		id,
		eventType: 'system',
		role: 'system',
		content: JSON.stringify({ kind: 'context_compaction', trigger: 'manual' }),
	})
const user = (content: string) => event({ role: 'user', content })

describe('getCompactedHistory', () => {
	it('returns null without a boundary', () => {
		expect(getCompactedHistory([user('hi'), event({})])).toBeNull()
	})

	it('folds everything before the latest boundary', () => {
		const events = [user('hi'), event({}), boundary('b1'), user('more'), event({}), boundary('b2'), event({})]
		expect(getCompactedHistory(events)).toEqual({ boundaryEventId: 'b2', foldedCount: 5 })
	})

	it('keeps the /compact message that asked for the boundary visible', () => {
		const events = [user('hi'), event({}), user('/compact focus on the tests'), boundary('b1'), event({})]
		expect(getCompactedHistory(events)).toEqual({ boundaryEventId: 'b1', foldedCount: 2 })
	})

	it('does not treat a message that merely mentions /compact as the trigger', () => {
		const events = [user('hi'), user('what does /compact do'), boundary('b1')]
		expect(getCompactedHistory(events)).toEqual({ boundaryEventId: 'b1', foldedCount: 2 })
	})

	it('returns null when nothing precedes the boundary', () => {
		expect(getCompactedHistory([boundary('b1'), event({})])).toBeNull()
		expect(getCompactedHistory([user('/compact'), boundary('b1'), event({})])).toBeNull()
	})
})

describe('revealedHistoryStart', () => {
	const history = { boundaryEventId: 'b1', foldedCount: 60 }

	it('reveals one page from the boundary backwards by default', () => {
		expect(revealedHistoryStart(history, undefined)).toBe(60 - COMPACTED_HISTORY_PAGE_SIZE)
	})

	it('reveals the requested count and clamps at the start of the stream', () => {
		expect(revealedHistoryStart(history, 10)).toBe(50)
		expect(revealedHistoryStart(history, 500)).toBe(0)
	})

	it('never reveals less than one event', () => {
		expect(revealedHistoryStart(history, 0)).toBe(59)
	})
})
