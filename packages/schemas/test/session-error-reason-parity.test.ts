import { Exit } from 'effect'
import * as Schema from 'effect/Schema'
import { describe, expect, test } from 'vitest'

import {
	SESSION_ERROR_REASONS as EFFECT_SESSION_ERROR_REASONS,
	SessionErrorReason,
} from '../src/effect/session/session-error-reason'
import {
	SESSION_ERROR_REASONS as ZOD_SESSION_ERROR_REASONS,
	SessionErrorReasonSchema,
} from '../src/zod/session/session-error-reason'

describe('session error reason schema parity', () => {
	test('Effect and Zod declare the same reasons in the same order', () => {
		expect([...ZOD_SESSION_ERROR_REASONS]).toEqual([...EFFECT_SESSION_ERROR_REASONS])
	})

	test('both sides accept every reason and reject unknown values', () => {
		for (const reason of EFFECT_SESSION_ERROR_REASONS) {
			expect(Exit.isSuccess(Schema.decodeUnknownExit(SessionErrorReason)(reason))).toBe(true)
			expect(SessionErrorReasonSchema.safeParse(reason).success).toBe(true)
		}
		for (const value of ['authenticated', '', 1, null, undefined]) {
			expect(Exit.isSuccess(Schema.decodeUnknownExit(SessionErrorReason)(value))).toBe(false)
			expect(SessionErrorReasonSchema.safeParse(value).success).toBe(false)
		}
	})
})
