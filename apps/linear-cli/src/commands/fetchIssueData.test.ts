import { describe, it, expect } from 'vitest'

import { initializeLinearClient } from '../utils/client'
import { fetchIssueData } from './fetchIssueData'

describe.skipIf(!process.env.LINEAR_API_KEY)('fetchIssueData integration', () => {
	it('fetches issue data with branch', async () => {
		const linear = initializeLinearClient(true)!
		const data = await fetchIssueData(linear, 'ENG-2615')
		expect(data.identifier).toBe('ENG-2615')
		expect(data.branch).toBeTruthy()
		expect(data.status).toBeTruthy()
	})

	it('fetches issue data with comments', async () => {
		const linear = initializeLinearClient(true)!
		const data = await fetchIssueData(linear, 'ENG-2615', { includeComments: true })
		expect(data.comments).toBeDefined()
		expect(Array.isArray(data.comments)).toBe(true)
	})

	it('throws on invalid issue ID format', async () => {
		const linear = initializeLinearClient(true)!
		await expect(fetchIssueData(linear, 'invalid')).rejects.toThrow('Invalid issue ID format')
	})
})
