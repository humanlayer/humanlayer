import { writeFile } from 'node:fs/promises'

import type { ModelInfo } from '@anthropic-ai/claude-agent-sdk'
import * as BunServices from '@effect/platform-bun/BunServices'
import { describe, it } from '@effect/vitest'
import { Clock, Deferred, Effect, Fiber, Layer, Option, Ref } from 'effect'
import * as ConfigProvider from 'effect/ConfigProvider'
import { HttpClient, HttpClientResponse } from 'effect/http'
import { TestClock } from 'effect/testing'
import { expect } from 'vitest'

import { makeHostModelCatalogSourceLive } from '../../src/effects/services/host-model-catalog/host-model-catalog.layer'
import { HostModelCatalogSource } from '../../src/effects/services/host-model-catalog/host-model-catalog.service'
import {
	type ClaudeQueryFactory,
	probeClaudeModels,
} from '../../src/effects/services/host-model-catalog/probe-claude-models'
import { probeCodexModels } from '../../src/effects/services/host-model-catalog/probe-codex-models'

const opusInfo: ModelInfo = {
	value: 'opus',
	resolvedModel: 'claude-opus-5',
	displayName: 'Opus',
	description: 'Opus 5',
	supportsEffort: true,
	supportedEffortLevels: ['low', 'medium', 'high'],
	supportsFastMode: true,
	supportsAutoMode: true,
}

/** A query factory whose only real behaviour is `supportedModels` and `close`; anything else dies loudly. */
function fakeQueryFactory(input: {
	readonly supportedModels: () => Promise<ModelInfo[]>
	readonly onClose?: () => void
}): ClaudeQueryFactory {
	const fake = {
		supportedModels: input.supportedModels,
		close: () => input.onClose?.(),
	}
	const query = new Proxy(fake, {
		get(target, property) {
			if (property in target) return target[property as keyof typeof target]
			throw new Error(`unexpected Query.${String(property)} during the model probe`)
		},
	})
	return (() => query) as unknown as ClaudeQueryFactory
}

const configLayer = (values: Record<string, string>) =>
	Layer.succeed(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown(values))

const jsonHttpClient = (status: number, body: unknown) =>
	Layer.succeed(
		HttpClient.HttpClient,
		HttpClient.make((request) =>
			Effect.succeed(
				HttpClientResponse.fromWeb(
					request,
					new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
				),
			),
		),
	)

const ONE_HOUR_MS = 3_600_000

const codexAuthFile = (path: string) =>
	Clock.currentTimeMillis.pipe(
		Effect.flatMap((now) =>
			Effect.promise(() =>
				writeFile(
					path,
					JSON.stringify({
						codex: {
							type: 'oauth',
							access: 'test-access',
							refresh: 'test-refresh',
							expires: now + ONE_HOUR_MS,
						},
					}),
				),
			),
		),
	)

describe('probeClaudeModels', () => {
	it.effect('returns the catalog rows and closes the query', () =>
		Effect.gen(function* () {
			const closed = yield* Ref.make(0)
			const query = fakeQueryFactory({
				supportedModels: () => Promise.resolve([opusInfo]),
				onClose: () => Effect.runSync(Ref.update(closed, (n) => n + 1)),
			})
			const entries = yield* probeClaudeModels({ query, claudePath: '/usr/bin/claude', cwd: '/tmp' })
			expect(entries).toMatchObject([{ value: 'opus', label: 'Opus 5', supportsAutoMode: true }])
			expect(yield* Ref.get(closed)).toBe(1)
		}),
	)

	it.effect('fails with a spawn error when the binary cannot be started', () =>
		Effect.gen(function* () {
			const query = (() => {
				throw new Error('ENOENT')
			}) as unknown as ClaudeQueryFactory
			const result = yield* probeClaudeModels({ query, claudePath: '/missing', cwd: '/tmp' }).pipe(Effect.flip)
			expect(result).toMatchObject({ _tag: 'ClaudeModelProbeError', operation: 'spawn' })
		}),
	)

	it.effect('fails with a timeout when the CLI never answers, and still closes it', () =>
		Effect.gen(function* () {
			const closed = yield* Deferred.make<void>()
			const query = fakeQueryFactory({
				supportedModels: () => new Promise<ModelInfo[]>(() => {}),
				onClose: () => Effect.runSync(Deferred.succeed(closed, undefined)),
			})
			const fiber = yield* probeClaudeModels({ query, claudePath: '/usr/bin/claude', cwd: '/tmp' }).pipe(
				Effect.flip,
				Effect.forkChild,
			)
			yield* TestClock.adjust('10 seconds')
			const result = yield* Fiber.join(fiber)
			expect(result).toMatchObject({ _tag: 'ClaudeModelProbeError', operation: 'timeout' })
			yield* Deferred.await(closed)
		}),
	)
})

describe('probeCodexModels', () => {
	const withAuthFile = <A, E, R>(effect: (authPath: string) => Effect.Effect<A, E, R>) =>
		Effect.gen(function* () {
			const authPath = `/tmp/host-model-catalog-${crypto.randomUUID()}.json`
			yield* codexAuthFile(authPath)
			return yield* effect(authPath).pipe(Effect.provide(configLayer({ FOLD_AUTH_PATH: authPath })))
		})

	it.effect('decodes the backend rows into catalog entries', () =>
		withAuthFile((authPath) =>
			probeCodexModels().pipe(
				Effect.map((entries) => {
					expect(entries.map((entry) => entry.value)).toEqual(['gpt-6-astra', 'gpt-6-sol'])
					expect(entries[0]).toMatchObject({
						isDefault: true,
						supportsFastMode: true,
						contextWindow: 258_400,
					})
				}),
				Effect.provide(
					jsonHttpClient(200, {
						models: [
							{
								slug: 'gpt-6-sol',
								display_name: 'GPT-6-Sol',
								visibility: 'list',
								priority: 2,
								context_window: 272_000,
								supported_reasoning_levels: [{ effort: 'low' }],
								service_tiers: [{ id: 'priority' }],
							},
							{
								slug: 'gpt-6-astra',
								display_name: 'GPT-6-Astra',
								visibility: 'list',
								priority: 1,
								context_window: 272_000,
								supported_reasoning_levels: [{ effort: 'low' }],
								service_tiers: [{ id: 'priority' }],
							},
						],
					}),
				),
			),
		).pipe(Effect.provide(BunServices.layer)),
	)

	it.effect('reports an unauthorized login without touching the body', () =>
		withAuthFile((authPath) =>
			probeCodexModels().pipe(
				Effect.flip,
				Effect.map((error) =>
					expect(error).toMatchObject({ _tag: 'CodexModelProbeError', reason: 'unauthorized', status: 401 }),
				),
				Effect.provide(jsonHttpClient(401, { detail: 'nope' })),
			),
		).pipe(Effect.provide(BunServices.layer)),
	)

	it.effect('reports a malformed catalog', () =>
		withAuthFile((authPath) =>
			probeCodexModels().pipe(
				Effect.flip,
				Effect.map((error) => expect(error).toMatchObject({ reason: 'malformed_response' })),
				Effect.provide(jsonHttpClient(200, { models: [{ display_name: 'no slug' }] })),
			),
		).pipe(Effect.provide(BunServices.layer)),
	)

	it.effect('reports not logged in when there is no stored credential', () =>
		probeCodexModels().pipe(
			Effect.flip,
			Effect.map((error) => expect(error).toMatchObject({ reason: 'not_logged_in' })),
			Effect.provide(jsonHttpClient(200, { models: [] })),
			Effect.provide(
				configLayer({ FOLD_AUTH_PATH: `/tmp/host-model-catalog-missing-${crypto.randomUUID()}.json` }),
			),
			Effect.provide(BunServices.layer),
		),
	)

	it.effect('skips a custom backend', () =>
		probeCodexModels().pipe(
			Effect.flip,
			Effect.map((error) => expect(error).toMatchObject({ reason: 'custom_backend' })),
			Effect.provide(jsonHttpClient(200, { models: [] })),
			Effect.provide(configLayer({ CODELAYER_CODEX_BASE_URL: 'https://proxy.example/v1' })),
			Effect.provide(BunServices.layer),
		),
	)
})

describe('HostModelCatalogSource', () => {
	it.effect('publishes a snapshot after the first probe with per-provider outcomes', () =>
		Effect.gen(function* () {
			const source = yield* HostModelCatalogSource
			expect(Option.isNone(yield* source.snapshot)).toBe(true)
			const loop = yield* source.run.pipe(Effect.forkChild)
			yield* source.awaitFirstProbe
			const snapshot = yield* source.snapshot
			yield* Fiber.interrupt(loop)
			expect(Option.isSome(snapshot)).toBe(true)
			const catalog = Option.getOrThrow(snapshot)
			expect(catalog.anthropic).toMatchObject({ status: 'unavailable', reason: 'binary_missing' })
			expect(catalog.codex).toMatchObject({ status: 'unavailable', reason: 'not_logged_in' })
		}).pipe(
			Effect.provide(
				makeHostModelCatalogSourceLive(
					fakeQueryFactory({ supportedModels: () => Promise.resolve([opusInfo]) }),
				).pipe(
					Layer.provide(jsonHttpClient(200, { models: [] })),
					Layer.provide(
						configLayer({
							HOME: '/tmp',
							PATH: '/nonexistent-bin',
							FOLD_AUTH_PATH: `/tmp/host-model-catalog-missing-${crypto.randomUUID()}.json`,
						}),
					),
					Layer.provide(BunServices.layer),
				),
			),
		),
	)
})
