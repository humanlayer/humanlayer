import { describe, expect, test } from 'vitest'

import { generateTaskSummary } from '../../src/agents/generate-task-summary'
import { buildMatrix } from '../_lib/matrix'

const MATRIX = buildMatrix({
	anthropic: { label: 'anthropic-haiku', modelId: 'claude-haiku-4-5' },
	openai: { label: 'openai-gpt-5-mini', modelId: 'gpt-5-mini' },
})

for (const { label, model } of MATRIX) {
	describe(`generate-task-summary [${label}]`, () => {
		test('short description — dark mode', async () => {
			const title = await generateTaskSummary('Add a dark mode toggle to the application settings page', {
				model,
			})
			expect(title.length).toBeGreaterThan(0)
			expect(title.length).toBeLessThanOrEqual(80)
			expect(title.toLowerCase()).toContain('dark mode')
		})

		test('long detailed description — auth flow', async () => {
			const title = await generateTaskSummary(
				'We need to implement OAuth2 login with Google and GitHub as identity providers. ' +
					'The flow should redirect to the provider, handle the callback, create or match a user ' +
					'record in our database, issue a JWT, and set it as an httpOnly cookie. We also need a ' +
					'logout endpoint that clears the cookie and revokes the refresh token.',
				{ model },
			)
			expect(title.length).toBeGreaterThan(0)
			expect(title.length).toBeLessThanOrEqual(80)
			expect(title.toLowerCase()).toMatch(/oauth|auth|login|sign.?in/)
		})

		test('description with ticket reference', async () => {
			const title = await generateTaskSummary(
				'[ENG-456] The search results page currently re-fetches on every keystroke. ' +
					'We should debounce the search input and cache results for repeated queries.',
				{ model },
			)
			expect(title.length).toBeGreaterThan(0)
			expect(title.length).toBeLessThanOrEqual(80)
			expect(title.toLowerCase()).toMatch(/search|debounce/)
		})

		test('vague description still produces a title', async () => {
			const title = await generateTaskSummary('Fix the bug on the homepage', { model })
			expect(title.length).toBeGreaterThan(0)
			expect(title.length).toBeLessThanOrEqual(80)
		})

		test('preserves acronyms without expanding them', async () => {
			const title = await generateTaskSummary('fix api auth token refresh in the SDK client', { model })

			expect(title).toMatch(/\bapi\b/)
			expect(title).toMatch(/\bSDK\b/)
			expect(title).not.toMatch(/application programming interface/i)
			expect(title).not.toMatch(/software development kit/i)
		})
	})
}
