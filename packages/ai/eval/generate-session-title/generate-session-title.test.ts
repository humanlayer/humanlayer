import { describe, expect, test } from 'vitest'

import { generateSessionTitle } from '../../src/agents/generate-session-title'
import { buildMatrix } from '../_lib/matrix'

const MATRIX = buildMatrix({
	anthropic: { label: 'anthropic-haiku', modelId: 'claude-haiku-4-5' },
	openai: { label: 'openai-gpt-5-mini', modelId: 'gpt-5-mini' },
})

for (const { label, model } of MATRIX) {
	describe(`generate-session-title [${label}]`, () => {
		test('prefixes titles with the mentioned rpi skill', async () => {
			const title = await generateSessionTitle(
				'use the rpi:implement-plan skill for .humanlayer/tasks/eng-1234-auth-migration',
				'ENG-1234',
				'Auth Migration',
				{ model },
			)

			expect(title).toMatch(/^implement-plan: /)
		})

		test('preserves acronyms without expanding them', async () => {
			const title = await generateSessionTitle('fix api auth token refresh in the SDK client', null, null, {
				model,
			})

			expect(title).toMatch(/\bapi\b/)
			expect(title).toMatch(/\bSDK\b/)
			expect(title).not.toMatch(/application programming interface/i)
			expect(title).not.toMatch(/software development kit/i)
		})
	})
}
