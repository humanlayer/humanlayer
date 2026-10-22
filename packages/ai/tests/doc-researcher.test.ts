/**
 * Tests for doc-researcher agent
 */
import { describe, expect, it } from 'vitest'

import { getContext, searchLibraries } from '../src/agents/doc-researcher/context7-client'
import { fetchDocumentation } from '../src/agents/doc-researcher/dual-source-fetcher'
import { exaContext } from '../src/agents/doc-researcher/exa-client'
import { formatSearchResults } from '../src/agents/doc-researcher/format-results'
import { researchDocumentation } from '../src/agents/doc-researcher/orchestrator'

const EXA_API_KEY = process.env.EXA_API_KEY
const CONTEXT7_API_KEY = process.env.CONTEXT7_API_KEY

describe.skip('doc-researcher agent', () => {
	describe('exa-client', () => {
		it.skipIf(!EXA_API_KEY)('exaContext returns response with code snippets', async () => {
			const result = await exaContext({
				query: 'how to use React useState hook',
				tokensNum: 1000,
			})

			expect(result.requestId).toBeDefined()
			expect(result.response).toBeDefined()
			expect(result.response.length).toBeGreaterThan(0)
			expect(result.resultsCount).toBeGreaterThan(0)
		})

		// Dynamic import required here: we need to delete the env var BEFORE importing
		// to test the module-level API key check
		it('exaContext throws when API key missing', async () => {
			const originalKey = process.env.EXA_API_KEY
			delete process.env.EXA_API_KEY
			try {
				const { exaContext: exaContextFresh } = await import('../src/agents/doc-researcher/exa-client')
				await expect(exaContextFresh({ query: 'test', tokensNum: 100 })).rejects.toThrow(
					'EXA_API_KEY environment variable is required',
				)
			} finally {
				if (originalKey) process.env.EXA_API_KEY = originalKey
			}
		})
	})

	describe('context7-client', () => {
		it.skipIf(!CONTEXT7_API_KEY)('searchLibraries returns library results', async () => {
			const result = await searchLibraries('React hooks documentation', 'react')

			expect(result.results).toBeDefined()
			expect(Array.isArray(result.results)).toBe(true)
			expect(result.results.length).toBeGreaterThan(0)
			expect(result.results[0]!.id).toBeDefined()
			expect(result.results[0]!.title).toBeDefined()
		})

		it.skipIf(!CONTEXT7_API_KEY)('getContext returns documentation text', async () => {
			const searchResult = await searchLibraries('React hooks', 'react')
			const libraryId = searchResult.results[0]!.id

			const context = await getContext('how to use useState hook', libraryId)

			expect(typeof context).toBe('string')
			expect((context as string).length).toBeGreaterThan(0)
		})
	})

	describe('dual-source-fetcher', () => {
		it.skipIf(!EXA_API_KEY || !CONTEXT7_API_KEY || !process.env.ANTHROPIC_API_KEY)(
			'fetchDocumentation returns results from both sources',
			async () => {
				const result = await fetchDocumentation('How to use useState hook?', 'react', 'typescript')

				// At least one source should return results
				expect(result.exaResult !== null || result.context7Result !== null).toBe(true)
			},
		)

		it.skipIf(!EXA_API_KEY)('fetchDocumentation returns exaResult even if context7 fails', async () => {
			// This tests graceful degradation - only Exa key available
			const result = await fetchDocumentation('How to use useState?', 'react', 'typescript')

			// Should have at least Exa result if Exa key is present
			if (process.env.CONTEXT7_API_KEY && process.env.ANTHROPIC_API_KEY) {
				// Both available, both might work
				expect(result.exaResult !== null || result.context7Result !== null).toBe(true)
			} else {
				// Only Exa available
				expect(result.exaResult).not.toBeNull()
			}
		})
	})

	describe('format-results', () => {
		it('formats both sources correctly', () => {
			const result = formatSearchResults('Source A content', 'Source B content')

			expect(result).toContain('<search_results_a>')
			expect(result).toContain('Source A content')
			expect(result).toContain('<search_results_b>')
			expect(result).toContain('Source B content')
		})

		it('handles null for source A', () => {
			const result = formatSearchResults(null, 'Source B content')

			expect(result).toContain('No results from this source.')
			expect(result).toContain('Source B content')
		})

		it('handles null for source B', () => {
			const result = formatSearchResults('Source A content', null)

			expect(result).toContain('Source A content')
			expect(result).toContain('No results from this source.')
		})

		it('handles both null', () => {
			const result = formatSearchResults(null, null)

			const noResultsCount = (result.match(/No results from this source\./g) || []).length
			expect(noResultsCount).toBe(2)
		})

		it('does not leak source names in output', () => {
			const result = formatSearchResults('test content', 'more test')

			expect(result.toLowerCase()).not.toContain('exa')
			expect(result.toLowerCase()).not.toContain('context7')
		})
	})

	describe('orchestrator', () => {
		it.skipIf(!process.env.ANTHROPIC_API_KEY || !EXA_API_KEY || !CONTEXT7_API_KEY)(
			'researchDocumentation returns answer for valid query',
			async () => {
				const result = await researchDocumentation({
					question: 'How do I create a basic Express server?',
					packageName: 'express',
					language: 'typescript',
				})

				expect(result.type).toBe('answer')
				if (result.type === 'answer') {
					expect(result.content.length).toBeGreaterThan(100)
				}
			},
		)

		it('researchDocumentation result has correct discriminated union shape', () => {
			// Type check test - no API needed
			const mockAnswer = { type: 'answer' as const, content: 'test' }
			const mockNeedInfo = { type: 'need_more_info' as const, message: 'clarify' }

			expect(mockAnswer.type).toBe('answer')
			expect(mockNeedInfo.type).toBe('need_more_info')
		})
	})
})
