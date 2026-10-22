import { Exit } from 'effect'
import * as Schema from 'effect/Schema'
import { describe, expect, test } from 'vitest'

import {
	isSessionStatusAwaitingLaunch,
	SESSION_STATUSES as EFFECT_SESSION_STATUSES,
	SESSION_STATUSES_AWAITING_LAUNCH as EFFECT_SESSION_STATUSES_AWAITING_LAUNCH,
	SessionStatus,
} from '../src/effect/session/session-status'
import {
	SESSION_STATUSES as ZOD_SESSION_STATUSES,
	SESSION_STATUSES_AWAITING_LAUNCH as ZOD_SESSION_STATUSES_AWAITING_LAUNCH,
	SessionStatusSchema,
} from '../src/zod/session/session-status'

describe('session status schema parity', () => {
	test('Effect and Zod declare the same statuses in the same order', () => {
		expect([...ZOD_SESSION_STATUSES]).toEqual([...EFFECT_SESSION_STATUSES])
		expect([...ZOD_SESSION_STATUSES_AWAITING_LAUNCH]).toEqual([...EFFECT_SESSION_STATUSES_AWAITING_LAUNCH])
	})

	test('both sides accept every status and reject unknown values', () => {
		for (const status of EFFECT_SESSION_STATUSES) {
			expect(Exit.isSuccess(Schema.decodeUnknownExit(SessionStatus)(status))).toBe(true)
			expect(SessionStatusSchema.safeParse(status).success).toBe(true)
		}
		for (const value of ['idle', '', 1, null, undefined]) {
			expect(Exit.isSuccess(Schema.decodeUnknownExit(SessionStatus)(value))).toBe(false)
			expect(SessionStatusSchema.safeParse(value).success).toBe(false)
		}
	})

	test('only queued statuses await a launch', () => {
		const awaiting = EFFECT_SESSION_STATUSES.filter(isSessionStatusAwaitingLaunch)
		expect(awaiting).toEqual(['ready_for_launch', 'waiting_for_workspace'])
	})
})
