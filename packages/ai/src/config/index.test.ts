import { describe, expect, test } from 'bun:test'

import { matchCodelayerAuthError } from './index'

describe('matchCodelayerAuthError', () => {
	test.each([
		[
			'Missing ANTHROPIC_API_KEY or auth for provider: anthropic. Set it before running codelayer.',
			'Anthropic (API)',
		],
		['Missing auth for provider: codex', 'OpenAI Codex'],
		['Missing oauth auth for provider: github-copilot', 'GitHub Copilot'],
		['Missing FIREWORKS_API_KEY or auth for provider: fireworks. Set it before running codelayer.', 'Firepass'],
	])('matches %s', (message, expected) => {
		expect(matchCodelayerAuthError(message)).toBe(expected)
	})

	test('returns null for generic failures', () => {
		expect(matchCodelayerAuthError('Unexpected daemon failure')).toBeNull()
		expect(matchCodelayerAuthError(null)).toBeNull()
		expect(matchCodelayerAuthError(undefined)).toBeNull()
	})
})
