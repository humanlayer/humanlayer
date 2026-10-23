import { describe, expect, test } from 'vitest'

import { generateTaskSlug, TASK_SLUG_MAX_LENGTH, truncateTaskSlug } from '@/lib/task-slug'

describe('generateTaskSlug', () => {
	test('normalizes task names into stable URL-safe slugs', () => {
		expect(generateTaskSlug('  Ship Mobile New Task Flow  ')).toBe('ship-mobile-new-task-flow')
		expect(generateTaskSlug('Fix: Linear/Jira ticket import!!!')).toBe('fix-linearjira-ticket-import')
		expect(generateTaskSlug('already---slugged')).toBe('already-slugged')
	})

	test('trims punctuation-only edges', () => {
		expect(generateTaskSlug('--- hello world ---')).toBe('hello-world')
		expect(generateTaskSlug('***')).toBe('')
	})

	test('truncates long slugs without leaving a trailing separator', () => {
		const longName = `${'a'.repeat(TASK_SLUG_MAX_LENGTH - 1)} ending`
		const slug = generateTaskSlug(longName)

		expect(slug).toBe('a'.repeat(TASK_SLUG_MAX_LENGTH - 1))
		expect(slug.length).toBeLessThanOrEqual(TASK_SLUG_MAX_LENGTH)
	})

	test('truncates existing slugs to the same limit', () => {
		expect(truncateTaskSlug('a'.repeat(TASK_SLUG_MAX_LENGTH + 1))).toBe('a'.repeat(TASK_SLUG_MAX_LENGTH))
	})
})
