import { describe, expect, test } from 'vitest'

import { generatePrefixedTaskSlug, generateTaskSlug, TASK_SLUG_MAX_LENGTH, truncateTaskSlug } from '@/lib/task-slug'

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

describe('generatePrefixedTaskSlug', () => {
	test('prepends the prefix and keeps the total within the limit', () => {
		const slug = generatePrefixedTaskSlug('eng-123-', 'Fix the login page')
		expect(slug).toBe('eng-123-fix-the-login-page')
		expect(slug.length).toBeLessThanOrEqual(TASK_SLUG_MAX_LENGTH)
	})

	test('truncates the body when the prefix plus summary exceeds the limit', () => {
		const longSummary = 'a'.repeat(100)
		const slug = generatePrefixedTaskSlug('eng-123-', longSummary)
		expect(slug.length).toBeLessThanOrEqual(TASK_SLUG_MAX_LENGTH)
		expect(slug).toMatch(/^eng-123-/)
		expect(slug).not.toMatch(/-$/)
	})

	test('Jira key with 110-char summary stays within the limit', () => {
		// Reproduces the exact scenario from issue #1160
		const jiraPrefix = 'eng-123-'
		const longTitle = 'a'.repeat(110)
		const slug = generatePrefixedTaskSlug(jiraPrefix, longTitle)
		expect(slug.length).toBeLessThanOrEqual(TASK_SLUG_MAX_LENGTH)
		expect(slug).toBe(`eng-123-${'a'.repeat(TASK_SLUG_MAX_LENGTH - jiraPrefix.length)}`)
	})

	test('GitHub owner-repo-number prefix with long title stays within the limit', () => {
		// Reproduces the GitHub variant: owner-name-42-<slug>
		const prefix = 'my-organization-my-repository-42-'
		const longTitle =
			'implement comprehensive end to end testing framework for all microservices across the platform'
		const slug = generatePrefixedTaskSlug(prefix, longTitle)
		expect(slug.length).toBeLessThanOrEqual(TASK_SLUG_MAX_LENGTH)
		expect(slug).toMatch(/^my-organization-my-repository-42-/)
		expect(slug).not.toMatch(/-$/)
	})

	test('strips trailing separator from the prefix when the body is empty', () => {
		expect(generatePrefixedTaskSlug('eng-123-', '***')).toBe('eng-123')
	})

	test('drops the body when the prefix consumes the full budget', () => {
		const prefix = 'x'.repeat(TASK_SLUG_MAX_LENGTH) + '-'
		const slug = generatePrefixedTaskSlug(prefix, 'anything')
		// Body is empty so the trailing separator is stripped, leaving only the x-run.
		expect(slug).toBe('x'.repeat(TASK_SLUG_MAX_LENGTH))
	})

	test('caps the result even when the prefix itself exceeds the limit', () => {
		const slug = generatePrefixedTaskSlug('x'.repeat(110) + '-', 'anything')
		expect(slug.length).toBeLessThanOrEqual(TASK_SLUG_MAX_LENGTH)
	})
})
