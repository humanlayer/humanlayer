import { afterEach, describe, expect, test } from 'vitest'

import { getGithubToken } from './github-access.service'

describe('getGithubToken', () => {
	const original = { GH_TOKEN: process.env.GH_TOKEN, GITHUB_TOKEN: process.env.GITHUB_TOKEN }
	afterEach(() => {
		process.env.GH_TOKEN = original.GH_TOKEN
		process.env.GITHUB_TOKEN = original.GITHUB_TOKEN
	})

	test('prefers GH_TOKEN over GITHUB_TOKEN (matching gh CLI precedence)', () => {
		process.env.GH_TOKEN = 'gh-token'
		process.env.GITHUB_TOKEN = 'github-token'
		expect(getGithubToken()).toBe('gh-token')
	})

	test('falls back to GITHUB_TOKEN when GH_TOKEN is unset', () => {
		delete process.env.GH_TOKEN
		process.env.GITHUB_TOKEN = 'github-token'
		expect(getGithubToken()).toBe('github-token')
	})

	test('trims surrounding whitespace and treats blank as absent', () => {
		process.env.GH_TOKEN = '  spaced-token  '
		expect(getGithubToken()).toBe('spaced-token')

		process.env.GH_TOKEN = '   '
		delete process.env.GITHUB_TOKEN
		expect(getGithubToken()).toBeUndefined()
	})

	test('is undefined when neither var is set', () => {
		delete process.env.GH_TOKEN
		delete process.env.GITHUB_TOKEN
		expect(getGithubToken()).toBeUndefined()
	})
})
