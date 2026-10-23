/**
 * Exa Context API Client
 * API Documentation: https://exa.ai/docs/reference/context
 */

import type { ExaContextRequest, ExaContextResponse } from './types'

export async function exaContext(request: ExaContextRequest): Promise<ExaContextResponse> {
	const apiKey = process.env.EXA_API_KEY
	if (!apiKey) {
		throw new Error('EXA_API_KEY environment variable is required')
	}

	const response = await fetch('https://api.exa.ai/context', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'x-api-key': apiKey,
		},
		body: JSON.stringify(request),
	})

	if (!response.ok) {
		const text = await response.text()
		throw new Error(`Exa API error ${response.status}: ${text}`)
	}

	return response.json() as Promise<ExaContextResponse>
}
