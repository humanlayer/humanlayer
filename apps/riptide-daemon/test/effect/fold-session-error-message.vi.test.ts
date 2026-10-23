import { describe, it } from '@effect/vitest'
import { Cause } from 'effect'
import { expect } from 'vitest'

import { describeFoldPromptFailure } from '@/effects/services/fold-sessions/fold-session-error-message'

describe('describeFoldPromptFailure', () => {
	it('provides the daemon-host CLI command when xAI credentials are absent', () => {
		const message = describeFoldPromptFailure(
			Cause.fail(new Error('No xAI OAuth credentials found in /Users/test/.fold/auth.json')),
		)

		expect(message).toContain('xAI authentication is required')
		expect(message).toContain('humanlayer fold auth xai login')
	})
})
