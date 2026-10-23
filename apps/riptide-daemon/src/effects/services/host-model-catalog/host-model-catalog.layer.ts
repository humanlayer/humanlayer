import { query as claudeQuery } from '@anthropic-ai/claude-agent-sdk'
import {
	type HostModelCatalog,
	type HostModelCatalogProviderResult,
	HostModelCatalogProviderResultSchema,
	unavailableHostModelCatalogProvider,
} from '@humanlayer/schemas/zod/model-catalog'
import * as Sentry from '@sentry/bun'
import {
	Cause,
	Clock,
	Config,
	Deferred,
	Effect,
	FileSystem,
	Layer,
	Option,
	Path,
	Ref,
	Schedule,
	Semaphore,
} from 'effect'
import type { ConfigError } from 'effect/Config'
import { HttpClient } from 'effect/http'

import { locateClaudeExecutable } from '../claude-sessions/claude-session-environment'
import { ClaudeModelProbeError, CodexModelProbeError } from './host-model-catalog.errors'
import { HostModelCatalogSource } from './host-model-catalog.service'
import { type ClaudeQueryFactory, probeClaudeModels } from './probe-claude-models'
import { probeCodexModels } from './probe-codex-models'

const REFRESH_INTERVAL = '30 minutes'

const claudeExecutableConfiguration = Effect.gen(function* () {
	const nonEmpty = (value: Option.Option<string>) => Option.filter(value, (path) => path.trim().length > 0)
	const humanLayerPath = nonEmpty(yield* Config.option(Config.String('HUMANLAYER_CLAUDE_PATH')))
	const riptidePath = nonEmpty(yield* Config.option(Config.String('RIPTIDE_CLAUDE_PATH')))
	return {
		configuredPath: Option.isSome(humanLayerPath) ? humanLayerPath : riptidePath,
		executableSearchPath: yield* Config.String('PATH').pipe(Config.withDefault('')),
		homeDirectory: yield* Config.String('HOME'),
	}
})

const captureProbeFailure = (provider: 'anthropic' | 'codex', error: ClaudeModelProbeError | CodexModelProbeError) =>
	Effect.logWarning('Host model catalog probe failed').pipe(
		Effect.annotateLogs({ provider, error }),
		Effect.andThen(
			error.unexpected
				? Effect.sync(() =>
						Sentry.captureException(error, { tags: { error_type: 'host_model_probe_failed', provider } }),
					)
				: Effect.void,
		),
	)

const configurationUnavailable = (provider: 'anthropic' | 'codex') => (error: ConfigError) =>
	Effect.logError('Host model catalog probe could not read its configuration').pipe(
		Effect.annotateLogs({ provider, error }),
		Effect.as(unavailableHostModelCatalogProvider('configuration')),
	)

const probeAnthropic = (query: ClaudeQueryFactory) =>
	Effect.gen(function* () {
		const configuration = yield* claudeExecutableConfiguration
		const claudePath = yield* locateClaudeExecutable(configuration)
		const models = yield* probeClaudeModels({ query, claudePath, cwd: configuration.homeDirectory })
		return { status: 'ok', models } satisfies HostModelCatalogProviderResult
	}).pipe(
		Effect.catchTag('ClaudeExecutableNotFoundError', () =>
			Effect.succeed(unavailableHostModelCatalogProvider('binary_missing')),
		),
		Effect.catchTag('ConfigError', configurationUnavailable('anthropic')),
		Effect.tapError((error) => captureProbeFailure('anthropic', error)),
		Effect.catchTag('ClaudeModelProbeError', (error) =>
			Effect.succeed(unavailableHostModelCatalogProvider(error.operation)),
		),
	)

const probeCodex = probeCodexModels().pipe(
	Effect.map((models) => ({ status: 'ok', models }) satisfies HostModelCatalogProviderResult),
	Effect.catchTag('ConfigError', configurationUnavailable('codex')),
	Effect.tapError((error) => captureProbeFailure('codex', error)),
	Effect.catchTag('CodexModelProbeError', (error) =>
		Effect.succeed(unavailableHostModelCatalogProvider(error.reason)),
	),
)

/**
 * The API validates the heartbeat with the same schema; a row the mapper could not make valid must
 * degrade to an unavailable provider here rather than fail every heartbeat after it.
 */
const publishable = (provider: 'anthropic' | 'codex', result: HostModelCatalogProviderResult) =>
	Effect.suspend(() => {
		const parsed = HostModelCatalogProviderResultSchema.safeParse(result)
		if (parsed.success) return Effect.succeed(parsed.data)
		return Effect.logError('Host model catalog probe produced rows the API would reject').pipe(
			Effect.annotateLogs({ provider, issues: parsed.error.issues }),
			Effect.andThen(
				Effect.sync(() =>
					Sentry.captureException(parsed.error, {
						tags: { error_type: 'host_model_catalog_invalid', provider },
					}),
				),
			),
			Effect.as(unavailableHostModelCatalogProvider('malformed_catalog')),
		)
	})

const probeHostModelCatalog = (query: ClaudeQueryFactory) =>
	Effect.all(
		{
			anthropic: probeAnthropic(query).pipe(Effect.flatMap((result) => publishable('anthropic', result))),
			codex: probeCodex.pipe(Effect.flatMap((result) => publishable('codex', result))),
		},
		{ concurrency: 2 },
	).pipe(
		Effect.flatMap(({ anthropic, codex }) =>
			Clock.currentTimeMillis.pipe(Effect.map((probedAt): HostModelCatalog => ({ probedAt, anthropic, codex }))),
		),
		Effect.tap((catalog) =>
			Effect.logInfo('Host model catalog probed').pipe(
				Effect.annotateLogs({
					anthropic: catalog.anthropic.status,
					anthropic_models: catalog.anthropic.models.length,
					codex: catalog.codex.status,
					codex_models: catalog.codex.models.length,
				}),
			),
		),
		Effect.withSpan('host_model_catalog.probe'),
	)

/**
 * Holds the latest probe result and the loop that keeps it fresh: once when `run` starts, then
 * every 30 minutes, so a Claude Code update or a Codex account change reaches the
 * picker without restarting the daemon. Construction starts nothing; the daemon forks `run`.
 */
export function makeHostModelCatalogSourceLive(query: ClaudeQueryFactory) {
	return Layer.effect(
		HostModelCatalogSource,
		Effect.gen(function* () {
			const probeServices = yield* Effect.context<FileSystem.FileSystem | Path.Path | HttpClient.HttpClient>()
			const latest = yield* Ref.make(Option.none<HostModelCatalog>())
			const firstProbe = yield* Deferred.make<void>()
			const oneProbeAtATime = yield* Semaphore.make(1)

			const refresh = oneProbeAtATime.withPermits(1)(
				probeHostModelCatalog(query).pipe(
					Effect.tap((catalog) => Ref.set(latest, Option.some(catalog))),
					Effect.tap(() => Deferred.succeed(firstProbe, undefined)),
					Effect.provide(probeServices),
				),
			)

			// A probe defect must not stop the loop: absorb it so the schedule keeps the snapshot
			// fresh (the typed probe failures are already recorded as unavailable providers).
			const refreshCycle = refresh.pipe(
				Effect.catchCause((cause) =>
					Effect.logError('Host model catalog refresh crashed').pipe(
						Effect.annotateLogs({ cause }),
						Effect.andThen(
							Effect.sync(() =>
								Sentry.captureException(Cause.squash(cause), {
									tags: { error_type: 'host_model_refresh_crashed' },
								}),
							),
						),
					),
				),
			)
			const scheduledRefresh = refreshCycle.pipe(Effect.repeat(Schedule.spaced(REFRESH_INTERVAL)))
			const run = scheduledRefresh.pipe(Effect.andThen(Effect.never))

			return HostModelCatalogSource.of({
				snapshot: Ref.get(latest),
				refresh,
				awaitFirstProbe: Deferred.await(firstProbe),
				run,
			})
		}),
	)
}

export const HostModelCatalogSourceLive = makeHostModelCatalogSourceLive(claudeQuery)
