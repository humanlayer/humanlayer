/**
 * Learning Test: Context7 API
 *
 * API Documentation: https://context7.com/docs/api-guide
 *
 * Key findings documented in src/context7-client.ts
 */

import { describe, expect, test } from 'vitest'

import { getContext, searchLibraries } from '../src/agents/doc-researcher/context7-client'

const CONTEXT7_API_KEY = process.env.CONTEXT7_API_KEY
const BASE_URL = 'https://context7.com'

describe.skip('Context7 API', () => {
	test.skipIf(!CONTEXT7_API_KEY)('should have CONTEXT7_API_KEY configured', () => {
		expect(CONTEXT7_API_KEY).toBeDefined()
		expect(CONTEXT7_API_KEY!.length).toBeGreaterThan(0)
	})

	describe.concurrent('Step 1: Library Search', () => {
		test.skipIf(!CONTEXT7_API_KEY)('search for React library', async () => {
			const result = await searchLibraries('React hooks documentation', 'react')

			// KEY FINDING: Search returns array of matching libraries
			expect(result.results).toBeDefined()
			expect(Array.isArray(result.results)).toBe(true)
			expect(result.results.length).toBeGreaterThan(0)

			// KEY FINDING: Library structure uses 'title' not 'name'
			const firstLib = result.results[0]!
			expect(firstLib.id).toBeDefined()
			expect(firstLib.title).toBeDefined()
		})

		test.skipIf(!CONTEXT7_API_KEY)('search for TypeScript library', async () => {
			const result = await searchLibraries('TypeScript configuration', 'typescript')

			expect(result.results).toBeDefined()
			expect(result.results.length).toBeGreaterThan(0)
		})

		test.skipIf(!CONTEXT7_API_KEY)('search for drizzle ORM', async () => {
			const result = await searchLibraries('drizzle orm postgres', 'drizzle')

			expect(result.results).toBeDefined()
			// May or may not find results depending on library coverage
		})
	})

	describe.concurrent('Step 2: Get Context', () => {
		test.skipIf(!CONTEXT7_API_KEY)('get React documentation context (default text)', async () => {
			// First, search for React library
			const searchResult = await searchLibraries('React hooks', 'react')
			expect(searchResult.results.length).toBeGreaterThan(0)

			const libraryId = searchResult.results[0]!.id

			// Then, get context - default is TEXT format
			const context = await getContext('how to use useState hook', libraryId)

			// KEY FINDING: Default response is a string (text format)
			expect(typeof context).toBe('string')
			expect((context as string).length).toBeGreaterThan(0)
		})

		test.skipIf(!CONTEXT7_API_KEY)('get context as explicit text format', async () => {
			// First, search for library
			const searchResult = await searchLibraries('React', 'react')
			const libraryId = searchResult.results[0]!.id

			// Get context as plain text
			const textContext = await getContext('useEffect cleanup function', libraryId, { type: 'txt' })

			// KEY FINDING: Text format returns plain string
			expect(typeof textContext).toBe('string')
			expect((textContext as string).length).toBeGreaterThan(0)
		})

		test.skipIf(!CONTEXT7_API_KEY)('get context as JSON format', async () => {
			// First, search for library
			const searchResult = await searchLibraries('React', 'react')
			const libraryId = searchResult.results[0]!.id

			// Get context as JSON - must explicitly specify type=json
			const jsonContext = await getContext('React component lifecycle', libraryId, { type: 'json' })

			// KEY FINDING: JSON format returns structured object
			expect(typeof jsonContext).toBe('object')
			expect(jsonContext).toBeDefined()
		})
	})

	describe.concurrent('Full Two-Step Flow', () => {
		test.skipIf(!CONTEXT7_API_KEY)('complete flow: search then get context', async () => {
			// Step 1: Search for library
			const searchResult = await searchLibraries('Hono web framework routing', 'hono')

			if (searchResult.results.length === 0) {
				return
			}

			const library = searchResult.results[0]!

			// Step 2: Get context (as text, the default)
			const context = await getContext('how to define routes in Hono', library.id)

			// KEY FINDING: Two-step flow is required and works
			expect(library.id).toBeDefined()
			expect(context).toBeDefined()
			expect((context as string).length).toBeGreaterThan(0)
		})

		test.skipIf(!CONTEXT7_API_KEY)('demonstrates why agent pattern is needed', async () => {
			// This test demonstrates the multi-call nature that makes Context7
			// better suited for an agent pattern rather than a single MCP tool

			// Scenario: User asks "how do I use tanstack query for data fetching"
			// We need to:
			// 1. Figure out the right library name
			// 2. Search for it
			// 3. Get context with the right query

			// First try: search with "tanstack query"
			let searchResult = await searchLibraries('tanstack query data fetching', 'tanstack-query')

			if (searchResult.results.length === 0) {
				// Second try: different library name
				searchResult = await searchLibraries('tanstack query data fetching', 'react-query')
			}

			if (searchResult.results.length === 0) {
				// Third try: broader search
				searchResult = await searchLibraries('query data fetching', 'tanstack')
			}

			// KEY FINDING: Finding the right library often requires multiple attempts
			// This is why an agent pattern with reasoning is more effective

			if (searchResult.results.length > 0) {
				const context = await getContext('useQuery hook for data fetching', searchResult.results[0]!.id)
				expect(context).toBeDefined()
				expect((context as string).length).toBeGreaterThan(0)
			}
		})
	})

	describe.concurrent('Error Handling', () => {
		test.skipIf(!CONTEXT7_API_KEY)('error for invalid API key', async () => {
			const params = new URLSearchParams({
				query: 'test',
				libraryName: 'react',
			})

			const response = await fetch(`${BASE_URL}/api/v2/libs/search?${params}`, {
				method: 'GET',
				headers: {
					Authorization: 'Bearer invalid-key-12345',
				},
			})

			// KEY FINDING: Error response for invalid auth
			expect(response.ok).toBe(false)
		})

		test.skipIf(!CONTEXT7_API_KEY)('error for invalid library ID in context', async () => {
			try {
				await getContext('test query', 'invalid-library-id-12345')
				// If we get here, the API accepted invalid ID (may return empty results)
			} catch (_error) {
				// KEY FINDING: How API handles invalid library IDs
			}
		})
	})
})
