import { describe, it } from '@effect/vitest'
import { ConfigProvider, Effect } from 'effect'

import { WorkosConfig, WorkosConfigLive } from '../../src/auth/effect/workos.service'
import { EnvironmentVariableNotFoundError } from '../../src/lib/effect/environment'

describe('WorkosConfig', () => {
	const values = {
		WORKOS_CLIENT_ID: 'client_test123',
		WORKOS_REDIRECT_URI: 'http://localhost:3000/callback',
		WORKOS_API_KEY: 'sk_test_abc123',
	}
	const loadConfig = WorkosConfig.pipe(Effect.provide(WorkosConfigLive))

	it.effect('builds the live SDK and JWKS URL from scoped configuration', ({ expect }) =>
		Effect.gen(function* () {
			const config = yield* loadConfig
			expect(config.workosClientId).toBe(values.WORKOS_CLIENT_ID)
			expect(config.workosRedirectUri).toBe(values.WORKOS_REDIRECT_URI)
			expect(config.workos).toBeDefined()
			expect(config.jwksUrl).toBe('https://api.workos.com/sso/jwks/client_test123')
		}).pipe(Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(values)))),
	)

	for (const variableName of Object.keys(values)) {
		for (const missingValue of [undefined, '']) {
			it.effect(`rejects ${variableName} when ${missingValue === '' ? 'empty' : 'missing'}`, ({ expect }) =>
				Effect.gen(function* () {
					const error = yield* Effect.flip(loadConfig)
					expect(error).toEqual(new EnvironmentVariableNotFoundError({ variableName }))
				}).pipe(
					Effect.provide(
						ConfigProvider.layer(ConfigProvider.fromUnknown({ ...values, [variableName]: missingValue })),
					),
				),
			)
		}
	}

	it.effect('isolates concurrent live config layers with distinct providers', ({ expect }) =>
		Effect.gen(function* () {
			const configs = yield* Effect.all(
				['first', 'second'].map((name) =>
					loadConfig.pipe(
						Effect.provide(
							ConfigProvider.layer(
								ConfigProvider.fromUnknown({
									WORKOS_CLIENT_ID: `client_${name}`,
									WORKOS_REDIRECT_URI: `https://${name}.test/callback`,
									WORKOS_API_KEY: `sk_test_${name}`,
								}),
							),
						),
					),
				),
				{ concurrency: 'unbounded' },
			)
			expect(configs.map((config) => config.workosClientId)).toEqual(['client_first', 'client_second'])
			expect(configs.map((config) => config.workosRedirectUri)).toEqual([
				'https://first.test/callback',
				'https://second.test/callback',
			])
			expect(configs.map((config) => config.jwksUrl)).toEqual([
				'https://api.workos.com/sso/jwks/client_first',
				'https://api.workos.com/sso/jwks/client_second',
			])
		}),
	)
})
