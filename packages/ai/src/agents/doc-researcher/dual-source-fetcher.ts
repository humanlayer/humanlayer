/**
 * Dual-Source Fetcher
 * Concurrently queries Exa and Context7 with graceful error handling.
 */

import { searchContext7WithResolution } from './context7-resolver'
import { exaContext } from './exa-client'
import type { DualSourceResult } from './types'

/**
 * Fetch documentation from both Exa and Context7 concurrently.
 * Gracefully handles individual source failures - if one source fails,
 * the other result is still returned.
 */
export async function fetchDocumentation(
	question: string,
	packageName: string,
	language: string,
): Promise<DualSourceResult> {
	const [exaResult, context7Result] = await Promise.all([
		fetchExa(question, packageName, language),
		fetchContext7(question, packageName, language),
	])

	return { exaResult, context7Result }
}

async function fetchExa(question: string, packageName: string, language: string): Promise<string | null> {
	try {
		const query = `Question: ${question} -- for ${packageName} in ${language}`
		const response = await exaContext({ query, tokensNum: 'dynamic' })
		return response.response
	} catch (error) {
		console.warn('Exa fetch failed, continuing with other sources:', error)
		return null
	}
}

async function fetchContext7(question: string, packageName: string, language: string): Promise<string | null> {
	try {
		const result = await searchContext7WithResolution(question, packageName, language)
		return result.rawResponse
	} catch (error) {
		console.warn('Context7 fetch failed, continuing with other sources:', error)
		return null
	}
}
