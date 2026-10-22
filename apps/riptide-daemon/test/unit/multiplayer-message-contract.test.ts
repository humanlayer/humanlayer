import { describe, expect, test } from 'vitest'

import { sessionHasActiveMultiplayerPrompting } from '../../src/effects/services/claude-sessions/multiplayer-message-contract'

const NOW = 1_000_000

describe('sessionHasActiveMultiplayerPrompting', () => {
	const grant = {
		multiplayer_prompting_user_ids: ['user_collab'],
		multiplayer_prompting_started_at: BigInt(NOW - 1000),
		multiplayer_prompting_expires_at: BigInt(NOW + 1000),
	}

	test('true for a live grant', () => {
		expect(sessionHasActiveMultiplayerPrompting(grant, NOW)).toBe(true)
	})

	test('true for an unbounded grant', () => {
		expect(sessionHasActiveMultiplayerPrompting({ ...grant, multiplayer_prompting_expires_at: null }, NOW)).toBe(
			true,
		)
	})

	test('false when the roster is empty', () => {
		expect(sessionHasActiveMultiplayerPrompting({ ...grant, multiplayer_prompting_user_ids: [] }, NOW)).toBe(false)
	})

	test('false before the grant starts', () => {
		expect(
			sessionHasActiveMultiplayerPrompting({ ...grant, multiplayer_prompting_started_at: BigInt(NOW + 1) }, NOW),
		).toBe(false)
	})

	test('false once the grant has expired', () => {
		expect(
			sessionHasActiveMultiplayerPrompting({ ...grant, multiplayer_prompting_expires_at: BigInt(NOW) }, NOW),
		).toBe(false)
	})

	test('false when never started', () => {
		expect(sessionHasActiveMultiplayerPrompting({ ...grant, multiplayer_prompting_started_at: null }, NOW)).toBe(
			false,
		)
	})
})
