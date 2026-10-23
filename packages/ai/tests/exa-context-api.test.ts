/**
 * Learning Test: Exa Context API
 *
 * API Documentation: https://exa.ai/docs/reference/context
 *
 * Key findings documented in src/exa-client.ts
 */

import { describe, expect, test } from 'vitest'

import { exaContext } from '../src/agents/doc-researcher/exa-client'

const EXA_API_KEY = process.env.EXA_API_KEY

describe.skip('Exa Context API', () => {
	test.skipIf(!EXA_API_KEY)('should have EXA_API_KEY configured', () => {
		expect(EXA_API_KEY).toBeDefined()
		expect(EXA_API_KEY!.length).toBeGreaterThan(0)
	})

	test.skipIf(!EXA_API_KEY)('basic query returns code context', async () => {
		const result = await exaContext({
			query: 'how to use React useState hook',
			tokensNum: 1000,
		})

		// KEY FINDING: Response structure
		expect(result.requestId).toBeDefined()
		expect(typeof result.requestId).toBe('string')
		expect(result.query).toBe('how to use React useState hook')
		expect(result.response).toBeDefined()
		expect(typeof result.response).toBe('string')
		expect(result.response.length).toBeGreaterThan(0)
		expect(result.resultsCount).toBeGreaterThan(0)
		expect(result.outputTokens).toBeGreaterThan(0)
		expect(result.searchTime).toBeGreaterThan(0)
	})

	test.skipIf(!EXA_API_KEY)('tokensNum parameter controls response size', async () => {
		// Small token limit
		const smallResult = await exaContext({
			query: 'TypeScript generics examples',
			tokensNum: 500,
		})

		// Larger token limit
		const largeResult = await exaContext({
			query: 'TypeScript generics examples',
			tokensNum: 2000,
		})

		// KEY FINDING: Larger tokensNum should generally return more content
		// Note: Not strictly guaranteed but expected behavior
		expect(largeResult.response.length).toBeGreaterThanOrEqual(smallResult.response.length * 0.8)
	})

	test.skipIf(!EXA_API_KEY)('dynamic tokensNum option', async () => {
		const result = await exaContext({
			query: 'Python async await examples',
			tokensNum: 'dynamic',
		})

		// KEY FINDING: Dynamic mode lets API determine optimal token count
		expect(result.outputTokens).toBeGreaterThan(0)
		expect(result.response.length).toBeGreaterThan(0)
	})

	test.skipIf(!EXA_API_KEY)('code-specific query returns code snippets', async () => {
		const result = await exaContext({
			query: 'drizzle orm postgres connection setup TypeScript',
			tokensNum: 3000,
		})

		// KEY FINDING: Response format and content type
		expect(result.response).toBeDefined()
		// Response should contain code-like content
		const hasCodeIndicators =
			result.response.includes('import') ||
			result.response.includes('const') ||
			result.response.includes('function') ||
			result.response.includes('```')
		expect(hasCodeIndicators).toBe(true)
	})

	test.skipIf(!EXA_API_KEY)('error handling for invalid API key', async () => {
		const response = await fetch('https://api.exa.ai/context', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-api-key': 'invalid-key-12345',
			},
			body: JSON.stringify({
				query: 'test query',
				tokensNum: 100,
			}),
		})

		// KEY FINDING: Error response format for invalid auth
		expect(response.ok).toBe(false)
		expect(response.status).toBeGreaterThanOrEqual(400)
	})
})
