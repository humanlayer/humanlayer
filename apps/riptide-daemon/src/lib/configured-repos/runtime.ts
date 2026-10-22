import * as BunFileSystem from '@effect/platform-bun/BunFileSystem'
import { Effect, Layer, ManagedRuntime } from 'effect'

import { Sentry } from '@/instrument'
import logger from '@/logger'

import { ConfiguredRepoTelemetry, GitRootResolverLive } from './load-configured-repo-context'
import { type ConfiguredRepoContext, ConfiguredRepoContextLive } from './service'

export const SentryConfiguredRepoTelemetryLive = Layer.succeed(ConfiguredRepoTelemetry, {
	info: (observation) =>
		Effect.sync(() => {
			logger.info({ discovery: 'configured-repos', ...observation }, 'Configured repo discovery')
		}),
	capture: (_warning, context) =>
		Effect.sync(() => {
			const safeError = new Error('Configured repository discovery failed')
			safeError.name = 'ConfiguredRepoDiscoveryError'
			logger.error(
				{ discovery: 'configured-repos', outcome: 'error', ...context },
				'Configured repo discovery failed',
			)
			Sentry.captureException(safeError, {
				tags: {
					discovery_stage: String(context.discoveryStage),
					source_kind: String(context.sourceKind),
					error_code: String(context.errorCode),
				},
				extra: {
					path: context.path,
					session_id: context.sessionId,
				},
			})
		}),
})

/**
 * The configured-repository service with its daemon adapters. File access comes from the ambient
 * platform `FileSystem`, which the daemon runtime provides once through `BunServices`.
 */
export const ConfiguredRepoContextRuntimeLive = ConfiguredRepoContextLive.pipe(
	Layer.provide(Layer.mergeAll(GitRootResolverLive, SentryConfiguredRepoTelemetryLive)),
)

export type ConfiguredRepoContextRuntime = ManagedRuntime.ManagedRuntime<ConfiguredRepoContext, unknown>

/** Standalone runtime for the promise bridge in `service.ts`; callers inside the daemon runtime yield the service. */
export const configuredRepoContextRuntime = ManagedRuntime.make(
	ConfiguredRepoContextRuntimeLive.pipe(Layer.provide(BunFileSystem.layer)),
)
