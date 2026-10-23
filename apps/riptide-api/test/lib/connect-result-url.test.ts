import type { RiptideClient } from '@humanlayer/riptide-api-contract/types/client'
import { RIPTIDE_CLIENTS } from '@humanlayer/riptide-api-contract/types/client'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import {
	buildConnectResultUrl,
	type ConnectResultProvider,
	type ConnectResultStatus,
} from '../../src/lib/connect-result-url'

const STATUSES: readonly ConnectResultStatus[] = [
	'connected',
	'access_denied',
	'auth_failed',
	'invalid_link',
	'unavailable',
]
const PROVIDERS: readonly ConnectResultProvider[] = ['linear', 'jira']

describe('buildConnectResultUrl', () => {
	let previousCloudOrigin: string | undefined

	beforeAll(() => {
		previousCloudOrigin = process.env.CLOUD_ORIGIN
		process.env.CLOUD_ORIGIN = 'https://cloud.example.test'
	})

	afterAll(() => {
		if (previousCloudOrigin === undefined) delete process.env.CLOUD_ORIGIN
		else process.env.CLOUD_ORIGIN = previousCloudOrigin
	})

	const matrix = PROVIDERS.flatMap((provider) =>
		RIPTIDE_CLIENTS.flatMap((client) => STATUSES.map((status) => ({ provider, client, status }))),
	)

	test.each(matrix)('$provider / $client / $status', ({ provider, client, status }) => {
		const url = new URL(buildConnectResultUrl({ provider, client, status }))

		// Every client resolves to CLOUD_ORIGIN — the deliberate divergence from billing,
		// which splits `native` off onto APP_ORIGIN.
		expect(url.origin).toBe('https://cloud.example.test')
		expect(url.pathname).toBe(`/connect/${provider}`)
		expect(url.searchParams.get('status')).toBe(status)
		expect(url.searchParams.get('client')).toBe(client)
	})

	test('carries the return client through unchanged', () => {
		for (const client of RIPTIDE_CLIENTS satisfies readonly RiptideClient[]) {
			const url = new URL(buildConnectResultUrl({ provider: 'linear', client, status: 'connected' }))
			expect(url.searchParams.get('client')).toBe(client)
		}
	})
})
