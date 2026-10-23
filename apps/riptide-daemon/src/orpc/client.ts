import { RiptideDaemonApiContract } from '@humanlayer/riptide-api-contract/contract-router'
import { encodeDaemonProcessEvent } from '@humanlayer/schemas/effect/daemon/process-event'
import { createORPCClient, isDefinedError, onError } from '@orpc/client'
import { ClientRetryPlugin } from '@orpc/client/plugins'
import type { ContractRouterClient } from '@orpc/contract'
import { OpenAPILink } from '@orpc/openapi-client/fetch'

import { Sentry } from '@/instrument'
import { setShutdownExitCode } from '@/lib/shutdown-exit-code'
import logger from '@/logger'

import { getHttpStatus, shouldRetryORPCRequest } from './retry-policy'

const MAX_RETRIES = 5

// Re-entrancy guard: prevents the auth failure handler from firing again
// when gracefulShutdown's sendShutdown() call also gets a 401/403
let authFailureTriggered = false

export type ORPCClient = ContractRouterClient<typeof RiptideDaemonApiContract>

/**
 * Create a new oRPC client for the daemon API.
 * @param apiOrigin - The API origin URL
 * @param token - The daemon identity token for authentication
 */
export function createDaemonORPCClient(apiOrigin: string, token: string): ORPCClient {
	const rpcBaseUrl = `${apiOrigin}/rpc/daemon/v1`
	const link = new OpenAPILink(RiptideDaemonApiContract, {
		url: rpcBaseUrl,
		headers: () => ({
			'x-daemon-authorization': token,
		}),
		interceptors: [
			onError((error) => {
				if (isDefinedError(error)) {
					// Check for auth failure (401 or 403)
					if (
						error != null &&
						typeof error === 'object' &&
						'defined' in error &&
						(error as { defined: boolean }).defined === true &&
						'status' in error
					) {
						const status = (error as { status: number }).status
						if (status === 401 || status === 403) {
							if (authFailureTriggered) {
								// Already handling auth failure - gracefulShutdown's sendShutdown()
								// will also hit this path, so we just bail out silently
								return
							}
							authFailureTriggered = true

							const code = 'code' in error ? (error as { code: string }).code : 'UNKNOWN'
							logger.fatal(
								{ err: error, status, code },
								'Daemon auth failed on oRPC call. Triggering graceful shutdown.',
							)
							console.error(
								encodeDaemonProcessEvent({
									type: 'auth_failure',
									message: `Authentication failed (${status}). Please sign in again.`,
								}),
							)
							// Set non-zero exit code before triggering graceful shutdown
							setShutdownExitCode(1)
							// Trigger graceful shutdown via SIGTERM so daemon.ts's gracefulShutdown()
							// handles session cleanup, API notification, and Sentry flush
							process.kill(process.pid, 'SIGTERM')
						}
					}
					logger.error(error)
				} else {
					logger.error(error, 'Unknown oRPC error')
				}
			}),
		],
		plugins: [
			new ClientRetryPlugin({
				default: {
					retry: () => MAX_RETRIES,
					shouldRetry: ({ error }) => {
						const status = getHttpStatus(error)
						if (status === 401 || status === 403) {
							const code =
								error != null && typeof error === 'object' && 'code' in error
									? (error as { code: string }).code
									: 'UNKNOWN'
							logger.fatal({ err: error, status, code }, 'oRPC auth failure detected - will not retry')
						}
						return shouldRetryORPCRequest(error)
					},
					retryDelay: () => 2_000,
					onRetry: (options) => {
						const path = options.path.join('.')
						logger.info(
							{
								err: options.error,
								path,
								rpcBaseUrl,
								attempt: options.attemptIndex,
								maxRetries: MAX_RETRIES,
							},
							'Retrying oRPC request',
						)
						return (retryWasSuccessful) => {
							if (retryWasSuccessful)
								logger.info(
									{ path, rpcBaseUrl, attempt: options.attemptIndex },
									'Successfully retried oRPC request',
								)
							else {
								logger.error(
									{
										err: options.error,
										path,
										rpcBaseUrl,
										attempt: options.attemptIndex,
										maxRetries: MAX_RETRIES,
									},
									'oRPC retry attempt failed',
								)
								if (options.attemptIndex >= MAX_RETRIES && !isDefinedError(options.error)) {
									Sentry.captureException(options.error, {
										tags: { error_type: 'daemon_orpc_retry_exhausted', path },
									})
								}
							}
						}
					},
				},
			}),
		],
	})

	return createORPCClient(link) as ORPCClient
}
