import { RiptideApiContract } from '@humanlayer/riptide-api-contract/contract-router'
import { createORPCClient } from '@orpc/client'
import { ClientRetryPlugin } from '@orpc/client/plugins'
import type { ContractRouterClient } from '@orpc/contract'
import { OpenAPILink } from '@orpc/openapi-client/fetch'

export type ApiORPCClient = ContractRouterClient<typeof RiptideApiContract>

/** Number of automatic retries for transient API failures (network drops, 429, 5xx responses). */
const API_RETRY_COUNT = 3

/**
 * Transient failures are retried: network errors (no status), 429 (rate limited), and 5xx. Other
 * 4xx client errors are not retried, since they will not succeed on retry.
 */
function isTransientApiError(error: unknown): boolean {
	if (error != null && typeof error === 'object' && 'status' in error) {
		const status = (error as { status: unknown }).status
		if (typeof status === 'number' && status >= 400 && status < 500 && status !== 429) return false
	}
	return true
}

/**
 * Build the OpenAPI link for the API, wiring in the shared retry policy. Mirrors the
 * riptide-daemon client's use of {@link ClientRetryPlugin} so every API call gets bounded,
 * backed-off retries without per-call-site retry code.
 */
function createApiLink(apiOrigin: string, accessToken?: string) {
	return new OpenAPILink(RiptideApiContract, {
		url: `${apiOrigin}/rpc/api/v1`,
		headers: accessToken ? () => ({ Authorization: `Bearer ${accessToken}` }) : undefined,
		plugins: [
			new ClientRetryPlugin({
				default: {
					retry: () => API_RETRY_COUNT,
					shouldRetry: ({ error }) => isTransientApiError(error),
					retryDelay: ({ attemptIndex }) => 250 * 2 ** attemptIndex,
				},
			}),
		],
	})
}

export function createApiORPCClient(apiOrigin: string, accessToken: string): ApiORPCClient {
	return createORPCClient(createApiLink(apiOrigin, accessToken)) as ApiORPCClient
}

export function createUnauthenticatedApiORPCClient(apiOrigin: string): ApiORPCClient {
	return createORPCClient(createApiLink(apiOrigin)) as ApiORPCClient
}
