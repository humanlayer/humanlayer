import { describe, expect, test } from 'vitest'

import { HUMANLAYER_SLASH_COMMANDS } from './humanlayer-skills'

describe('HumanLayer slash commands', () => {
	test('includes the standalone show-me skill', () => {
		expect(HUMANLAYER_SLASH_COMMANDS).toContainEqual({
			name: '/hl:show-me',
			source: 'bundled',
		})
	})

	test('includes the orchestrate skill', () => {
		expect(HUMANLAYER_SLASH_COMMANDS).toContainEqual({
			name: '/hl:orchestrate',
			source: 'bundled',
		})
	})

	test('includes the teleport skill', () => {
		expect(HUMANLAYER_SLASH_COMMANDS).toContainEqual({
			name: '/hl:teleport',
			source: 'bundled',
		})
	})
})
