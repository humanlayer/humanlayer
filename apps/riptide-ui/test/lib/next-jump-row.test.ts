import { describe, expect, it } from 'vitest'

import { nextJumpRow } from '@/lib/notifications/next-jump-row'
import type { NotificationRow } from '@/lib/notifications/notification-row'

function row(key: string, at: number): NotificationRow {
	return {
		key,
		kind: 'approval',
		at,
		actors: [{ agent: true }],
		count: 1,
		subject: key,
		taskName: null,
		detail: null,
		destination: { kind: 'session', sessionId: key },
		dismissible: false,
	}
}

describe('nextJumpRow', () => {
	const rows = [row('newest', 300), row('middle', 200), row('oldest', 100)]

	it('picks the newest row when nothing was opened', () => {
		expect(nextJumpRow(rows, {})?.key).toBe('newest')
	})

	it('walks down the list as rows are opened', () => {
		expect(nextJumpRow(rows, { newest: 400 })?.key).toBe('middle')
		expect(nextJumpRow(rows, { newest: 400, middle: 400 })?.key).toBe('oldest')
	})

	it('returns nothing once every row was opened', () => {
		expect(nextJumpRow(rows, { newest: 400, middle: 400, oldest: 400 })).toBeUndefined()
	})

	it('comes back to a row that has a newer event than when it was opened', () => {
		expect(nextJumpRow(rows, { newest: 250 })?.key).toBe('newest')
	})
})
