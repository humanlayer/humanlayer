import { LinearClient } from '@linear/sdk'
import { describe, expect, it } from 'vitest'

import { ensureLinkToIssue } from './ensureLink'

describe.skipIf(!process.env.LINEAR_API_KEY)('ensureLinkToIssue', () => {
	let linear: LinearClient

	it('returns error for invalid URL', async () => {
		linear = new LinearClient({ apiKey: process.env.LINEAR_API_KEY! })

		const result = await ensureLinkToIssue(linear, 'ENG-2600', 'not-a-url', {})

		expect(result.created).toBe(false)
		expect(result.skipped).toBe(false)
		expect(result.error).toBe('Invalid URL format')
	})

	it('returns error for non-existent issue', async () => {
		linear = new LinearClient({ apiKey: process.env.LINEAR_API_KEY! })

		const result = await ensureLinkToIssue(linear, 'NOTATEAM-99999', 'https://example.com/test', {})

		expect(result.created).toBe(false)
		expect(result.skipped).toBe(false)
		expect(result.error).toContain('not found')
	})

	it('creates new attachment when URL does not exist', async () => {
		linear = new LinearClient({ apiKey: process.env.LINEAR_API_KEY! })

		// Use a unique URL to avoid collision with previous test runs
		const uniqueUrl = `https://example.com/test-${Date.now()}`

		const result = await ensureLinkToIssue(linear, 'ENG-2600', uniqueUrl, { title: 'Test Link' })

		// Either created new or already exists from previous run
		expect(result.error).toBeUndefined()
		expect(result.created || result.skipped).toBe(true)
	})

	it('skips creation when URL already exists', async () => {
		linear = new LinearClient({ apiKey: process.env.LINEAR_API_KEY! })

		// First, create an attachment
		const testUrl = `https://example.com/idempotent-test-${Date.now()}`

		const firstResult = await ensureLinkToIssue(linear, 'ENG-2600', testUrl, { title: 'Idempotent Test' })

		expect(firstResult.error).toBeUndefined()
		expect(firstResult.created).toBe(true)

		// Now try to create the same attachment again
		const secondResult = await ensureLinkToIssue(linear, 'ENG-2600', testUrl, { title: 'Idempotent Test' })

		expect(secondResult.error).toBeUndefined()
		expect(secondResult.skipped).toBe(true)
		expect(secondResult.created).toBe(false)
	})
})
