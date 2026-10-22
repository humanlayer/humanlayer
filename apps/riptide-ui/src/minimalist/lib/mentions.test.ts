import { describe, expect, it } from 'vitest'

import { insertMention, mentionAt } from '@/minimalist/lib/mentions'

describe('mentionAt', () => {
	it('finds the @word at the caret', () => {
		expect(mentionAt('read @pla', 9)).toEqual({ start: 5, query: 'pla' })
		expect(mentionAt('@', 1)).toEqual({ start: 0, query: '' })
	})

	it('ignores emails, finished mentions, and text after the caret', () => {
		expect(mentionAt('mail dex@x.dev', 14)).toBeNull()
		expect(mentionAt('read @plan.md now', 17)).toBeNull()
		expect(mentionAt('read @plan now', 4)).toBeNull()
	})
})

describe('insertMention', () => {
	it('replaces the query and puts the caret after a space', () => {
		const at = { start: 5, query: 'pla' }
		expect(insertMention('read @pla', at, '@docs/plan.md')).toEqual({
			value: 'read @docs/plan.md ',
			caret: 19,
		})
		expect(insertMention('read @pla and fix', at, '@plan.md').value).toBe('read @plan.md and fix')
	})
})
