import * as Sentry from '@sentry/bun'
import { Effect } from 'effect'

import { shutdownAllSessions } from '@/agents/claudecode/shutdown'
import type { DaemonRuntime } from '@/effects/runtime'
import { ClaudeSessions } from '@/effects/services/claude-sessions/claude-sessions.service'
import { FoldSessionRunner } from '@/effects/services/fold-sessions/fold-session-runner.service'
import { sendShutdown } from '@/lib/heartbeat'
import type { ISyncService } from '@/lib/sync-service'
import logger from '@/logger'
import type { ORPCClient } from '@/orpc/client'

const SHUTDOWN_NOTIFICATION_TIMEOUT_MS = 2_000

const withTimeout = async (operation: Promise<unknown>, timeoutMs: number): Promise<void> => {
	let timeout: ReturnType<typeof setTimeout> | undefined
	try {
		await Promise.race([
			operation,
			new Promise<never>((_, reject) => {
				timeout = setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)), timeoutMs)
			}),
		])
	} finally {
		if (timeout !== undefined) clearTimeout(timeout)
	}
}

type ShutdownOptions = {
	readonly orpc: ORPCClient
	readonly hostId: string
	readonly stopHeartbeat: () => void
	readonly stopOrphanDetection: () => void
	readonly syncService: ISyncService
	readonly stopSubscriptions: () => Promise<unknown> | void
	readonly stopSelfUpdate?: () => Promise<void>
	readonly stopCaptureSources?: () => Promise<void> | void
	readonly runtime: DaemonRuntime
	readonly notificationTimeoutMs?: number
}

/** Creates the daemon's ordered graceful shutdown operation. */
export const createGracefulShutdown = (options: ShutdownOptions) => {
	let shutdown: Promise<void> | undefined
	return (signal: string): Promise<void> => {
		if (shutdown !== undefined) return shutdown
		shutdown = (async () => {
			logger.info({ signal }, 'Received shutdown signal, interrupting running sessions')
			options.stopOrphanDetection()
			options.stopHeartbeat()

			const attempt = async (name: string, operation: () => unknown) => {
				try {
					await Promise.resolve(operation())
				} catch (error) {
					logger.error({ err: error, operation: name }, 'Graceful shutdown operation failed')
					Sentry.captureException(error, { tags: { error_type: 'graceful_shutdown', operation: name } })
				}
			}

			await attempt('self_update', () => options.stopSelfUpdate?.())
			await attempt('sessions', async () => {
				await options.runtime.runPromise(
					Effect.gen(function* () {
						const claudeSessions = yield* ClaudeSessions
						const foldSessions = yield* FoldSessionRunner
						yield* Effect.all(
							[claudeSessions.shutdownActiveClaudeSessions, foldSessions.shutdownActiveSessions],
							{ concurrency: 'unbounded', discard: true },
						)
					}),
				)
				await shutdownAllSessions()
				logger.info('Session shutdown complete')
			})
			await attempt('subscriptions', options.stopSubscriptions)
			await attempt('capture_sources', () => options.stopCaptureSources?.())
			await attempt('sync_service', options.syncService.shutdown.bind(options.syncService))
			await attempt('notification', () =>
				withTimeout(
					sendShutdown(options.orpc, options.hostId, 'Session failed due to daemon shutdown'),
					options.notificationTimeoutMs ?? SHUTDOWN_NOTIFICATION_TIMEOUT_MS,
				),
			)
			await attempt('runtime_dispose', () => options.runtime.dispose())
			logger.info('Graceful shutdown complete')
			await Sentry.flush(2_000)
			await Sentry.close(2_000)
		})()
		return shutdown
	}
}
