import { describe, expect, test } from 'vitest'

import { shouldMarkSessionUnread } from '../../src/lib/shouldMarkSessionUnread'

const OWNER_USER_ID = 'user-owner'
const OTHER_USER_ID = 'user-other'

type TestSession = {
	id: string
	status: string
	created_by: string
}

function makeSession(overrides?: Partial<TestSession>): TestSession {
	return {
		id: 'session-1',
		status: 'ready_for_input',
		created_by: OWNER_USER_ID,
		...overrides,
	}
}

function makeUpdate(prevStatus: string, value: TestSession) {
	return {
		type: 'update' as const,
		previousValue: { ...value, status: prevStatus } as never,
		value: value as never,
	}
}

describe('shouldMarkSessionUnread', () => {
	// -------------------------------------------------------------------------
	// Qualifying transition (ready_for_input only)
	// -------------------------------------------------------------------------

	test('qualifies on transition into ready_for_input', () => {
		const change = makeUpdate('running', makeSession({ status: 'ready_for_input' }))
		expect(shouldMarkSessionUnread(change, null, OWNER_USER_ID)).toBe(true)
	})

	// -------------------------------------------------------------------------
	// Non-qualifying transitions
	// -------------------------------------------------------------------------

	test('does NOT qualify on transition into needs_approval (Resolved Q1)', () => {
		const change = makeUpdate('running', makeSession({ status: 'needs_approval' }))
		expect(shouldMarkSessionUnread(change, null, OWNER_USER_ID)).toBe(false)
	})

	test('does not qualify on transition into failed', () => {
		const change = makeUpdate('running', makeSession({ status: 'failed' }))
		expect(shouldMarkSessionUnread(change, null, OWNER_USER_ID)).toBe(false)
	})

	test('does not qualify on transition into interrupted', () => {
		const change = makeUpdate('running', makeSession({ status: 'interrupted' }))
		expect(shouldMarkSessionUnread(change, null, OWNER_USER_ID)).toBe(false)
	})

	test('same-status update is skipped (prev === next === ready_for_input)', () => {
		const change = makeUpdate('ready_for_input', makeSession({ status: 'ready_for_input' }))
		expect(shouldMarkSessionUnread(change, null, OWNER_USER_ID)).toBe(false)
	})

	// -------------------------------------------------------------------------
	// Non-update changes
	// -------------------------------------------------------------------------

	test('insert change is skipped', () => {
		const change = {
			type: 'insert' as const,
			value: makeSession({ status: 'ready_for_input' }) as never,
		}
		expect(shouldMarkSessionUnread(change, null, OWNER_USER_ID)).toBe(false)
	})

	test('delete change is skipped', () => {
		const change = {
			type: 'delete' as const,
			value: makeSession({ status: 'ready_for_input' }) as never,
		}
		expect(shouldMarkSessionUnread(change, null, OWNER_USER_ID)).toBe(false)
	})

	// -------------------------------------------------------------------------
	// Audience gating
	// -------------------------------------------------------------------------

	test('non-owner sessions are skipped', () => {
		const change = makeUpdate('running', makeSession({ status: 'ready_for_input', created_by: OTHER_USER_ID }))
		expect(shouldMarkSessionUnread(change, null, OWNER_USER_ID)).toBe(false)
	})

	test('when viewer user id is undefined, no audience check is applied', () => {
		const change = makeUpdate('running', makeSession({ status: 'ready_for_input', created_by: OTHER_USER_ID }))
		expect(shouldMarkSessionUnread(change, null, undefined)).toBe(true)
	})

	// -------------------------------------------------------------------------
	// Currently-viewing suppression
	// -------------------------------------------------------------------------

	test('skipped when the current route is on this session', () => {
		const change = makeUpdate('running', makeSession({ id: 'session-current', status: 'ready_for_input' }))
		expect(shouldMarkSessionUnread(change, 'session-current', OWNER_USER_ID)).toBe(false)
	})

	test('not skipped when the current route is on a different session', () => {
		const change = makeUpdate('running', makeSession({ id: 'session-1', status: 'ready_for_input' }))
		expect(shouldMarkSessionUnread(change, 'session-other', OWNER_USER_ID)).toBe(true)
	})
})
