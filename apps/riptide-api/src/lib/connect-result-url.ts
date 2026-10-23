import type { RiptideClient } from '@humanlayer/riptide-api-contract/types/client'

import { requireEnvironment } from './environment'

export type ConnectResultProvider = 'linear' | 'jira'

export type ConnectResultStatus = 'connected' | 'access_denied' | 'auth_failed' | 'invalid_link' | 'unavailable'

/**
 * The analogue of `buildBillingClientUrl`, with one deliberate divergence: every client
 * resolves to `CLOUD_ORIGIN`. There is one result screen, in one app; `client` only decides
 * which of its two buttons is primary. riptide-ui served at `APP_ORIGIN` has no connect
 * surface of its own to return to, so a second copy of the screen would buy nothing.
 */
export function buildConnectResultUrl(input: {
	provider: ConnectResultProvider
	client: RiptideClient
	status: ConnectResultStatus
}): string {
	const url = new URL(`/connect/${input.provider}`, requireEnvironment('CLOUD_ORIGIN', 'http://localhost:5174'))
	url.searchParams.set('status', input.status)
	url.searchParams.set('client', input.client)
	return url.toString()
}
