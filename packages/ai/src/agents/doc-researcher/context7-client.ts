/**
 * Context7 API Client
 * API Documentation: https://context7.com/docs/api-guide
 */

import type { Context7ContextResponse, Context7SearchResponse } from './types'

const BASE_URL = 'https://context7.com'

export async function searchLibraries(query: string, libraryName: string): Promise<Context7SearchResponse> {
	const apiKey = process.env.CONTEXT7_API_KEY
	console.log('[Context7 DEBUG] CONTEXT7_API_KEY present:', !!apiKey)
	console.log('[Context7 DEBUG] CONTEXT7_API_KEY length:', apiKey?.length)
	console.log(
		'[Context7 DEBUG] CONTEXT7_API_KEY preview:',
		apiKey ? `${apiKey.slice(0, 10)}...${apiKey.slice(-4)} (total ${apiKey.length} chars)` : 'undefined',
	)
	console.log(
		'[Context7 DEBUG] CONTEXT7_API_KEY charCodes of last 5:',
		apiKey
			?.slice(-5)
			.split('')
			.map((c) => c.charCodeAt(0)),
	)
	if (!apiKey) {
		throw new Error('CONTEXT7_API_KEY environment variable is required')
	}

	const params = new URLSearchParams({ query, libraryName })
	const url = `${BASE_URL}/api/v2/libs/search?${params.toString()}`
	console.log('[Context7 DEBUG] Request URL:', url)
	console.log('[Context7 DEBUG] Authorization header:', `Bearer ${apiKey.slice(0, 10)}...${apiKey.slice(-4)}`)
	const response = await fetch(url, {
		method: 'GET',
		headers: { Authorization: `Bearer ${apiKey}` },
	})

	if (!response.ok) {
		const text = await response.text()
		throw new Error(`Context7 search error ${response.status}: ${text}`)
	}

	return response.json() as Promise<Context7SearchResponse>
}

export async function getContext(
	query: string,
	libraryId: string,
	options?: { type?: 'json' | 'txt' },
): Promise<Context7ContextResponse | string> {
	const apiKey = process.env.CONTEXT7_API_KEY
	if (!apiKey) {
		throw new Error('CONTEXT7_API_KEY environment variable is required')
	}

	const params = new URLSearchParams({ query, libraryId })
	params.set('type', options?.type ?? 'txt')

	const response = await fetch(`${BASE_URL}/api/v2/context?${params.toString()}`, {
		method: 'GET',
		headers: { Authorization: `Bearer ${apiKey}` },
	})

	if (!response.ok) {
		const text = await response.text()
		throw new Error(`Context7 context error ${response.status}: ${text}`)
	}

	if (options?.type === 'json') {
		return response.json() as Promise<Context7ContextResponse>
	}
	return response.text()
}
