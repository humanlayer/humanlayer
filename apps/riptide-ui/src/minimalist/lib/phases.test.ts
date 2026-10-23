import { describe, expect, it } from 'vitest'

import { chapterName } from './phases'

describe('chapter names', () => {
	it('keeps phase and explicit name precedence, then uses a generated summary or session order', () => {
		expect(
			chapterName({ labels: [{ name: 'rpi:research' }], title: 'My name', summary: 'Generated summary' }, 0),
		).toBe('Research')
		expect(chapterName({ title: 'My name', summary: 'Generated summary' }, 0)).toBe('My name')
		expect(chapterName({ title: ' ', summary: ' Generated summary ' }, 0)).toBe('Generated summary')
		expect(chapterName({ title: null, summary: null }, 2)).toBe('Session 3')
	})
})
