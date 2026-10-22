import { describe, expect, test } from 'vitest'

import { parseFoldPromptCommand } from '@/effects/services/fold-sessions/fold-prompt-command'

describe('parseFoldPromptCommand', () => {
	test.each(['/compact', ' /compact ', '\n/compact\n'])('parses a standalone compact command: %j', (prompt) => {
		expect(parseFoldPromptCommand(prompt)).toEqual({ _tag: 'Compact', additionalInstructions: null })
	})

	test('preserves all trailing batched text as compaction guidance', () => {
		expect(parseFoldPromptCommand('/compact Keep commands.\n\nKeep failed approaches.')).toEqual({
			_tag: 'Compact',
			additionalInstructions: 'Keep commands.\n\nKeep failed approaches.',
		})
	})

	test.each(['please /compact this', '/compactness', '`/compact`', '/bro /compact'])(
		'leaves ordinary prompt text unchanged: %j',
		(prompt) => {
			expect(parseFoldPromptCommand(prompt)).toEqual({ _tag: 'Prompt', prompt })
		},
	)
})
