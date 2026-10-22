import { describe, it } from '@effect/vitest'
import { ConfigProvider, Effect } from 'effect'

import {
	DaemonTokenVerificationConfig,
	DaemonTokenVerificationConfigLive,
} from '../../src/auth/effect/daemon-token.service'
import { EnvironmentVariableNotFoundError } from '../../src/lib/effect/environment'

describe('DaemonTokenVerificationConfig', () => {
	// Loading decodes PEM text; cryptographic key validation belongs to the verifier.
	const publicKeyPem = `-----BEGIN PUBLIC KEY-----
test/key/placeholder
-----END PUBLIC KEY-----`
	const loadConfig = DaemonTokenVerificationConfig.pipe(Effect.provide(DaemonTokenVerificationConfigLive))
	const variableName = 'RIPTIDE_DAEMON_TOKEN_PUBLIC_KEY'

	it.effect('decodes configured base64 into the expected PEM', ({ expect }) =>
		Effect.gen(function* () {
			const config = yield* loadConfig
			expect(config.publicKeyPem).toBe(publicKeyPem)
		}).pipe(
			Effect.provide(
				ConfigProvider.layer(
					ConfigProvider.fromUnknown({ [variableName]: Buffer.from(publicKeyPem).toString('base64') }),
				),
			),
		),
	)

	for (const value of [undefined, '']) {
		it.effect(`rejects a ${value === '' ? 'empty' : 'missing'} public key`, ({ expect }) =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(loadConfig)
				expect(error).toEqual(new EnvironmentVariableNotFoundError({ variableName }))
			}).pipe(Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ [variableName]: value })))),
		)
	}

	it.effect('isolates concurrent live config layers with distinct providers', ({ expect }) =>
		Effect.gen(function* () {
			const pems = [publicKeyPem, publicKeyPem.replace('placeholder', 'second')]
			const configs = yield* Effect.all(
				pems.map((pem) =>
					loadConfig.pipe(
						Effect.provide(
							ConfigProvider.layer(
								ConfigProvider.fromUnknown({ [variableName]: Buffer.from(pem).toString('base64') }),
							),
						),
					),
				),
				{ concurrency: 'unbounded' },
			)
			expect(configs.map((config) => config.publicKeyPem)).toEqual(pems)
		}),
	)
})
