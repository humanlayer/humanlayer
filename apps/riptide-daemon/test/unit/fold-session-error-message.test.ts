import { Cause } from 'effect'
import { describe, expect, test } from 'vitest'

import { describeFoldPromptFailure } from '@/effects/services/fold-sessions/fold-session-error-message'

describe('describeFoldPromptFailure', () => {
	test('turns incompatible model schemas into actionable guidance', () => {
		const schemaError = new Error('Missing key\n  at ["model"]["modelId"]')
		const eventLogError = new Error('Invalid EventLog entry input', { cause: schemaError })

		expect(describeFoldPromptFailure(Cause.die(eventLogError))).toBe(
			"Fold could not run this session: Fold's model configuration is incompatible with this runtime (missing modelId). Restart Riptide after updating Fold.",
		)
	})

	test('shows actionable provider errors', () => {
		expect(describeFoldPromptFailure(Cause.fail(new Error('Codex authentication expired')))).toBe(
			'Fold could not run this session: Codex authentication expired',
		)
	})

	test('uses a useful fallback for opaque failures', () => {
		expect(describeFoldPromptFailure(Cause.die({ internal: true }))).toBe(
			'Fold could not run this session. Check the daemon logs for details.',
		)
	})
})
