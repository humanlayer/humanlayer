import { Context, Effect, Layer } from 'effect'

import { EnvironmentVariable } from '@/lib/effect/environment'

/**
 *
 */
export class DaemonTokenVerificationConfig extends Context.Service<
	DaemonTokenVerificationConfig,
	{
		readonly publicKeyPem: string
	}
>()('DaemonTokenVerificationConfig') {}

/**
 * This configuration layer loads the RIPTIDE_DAEMON_TOKEN_PUBLIC_KEY from the env
 
 */
export const DaemonTokenVerificationConfigLive = Layer.effect(
	DaemonTokenVerificationConfig,
	Effect.gen(function* () {
		const base64EncodedPublicKey = yield* EnvironmentVariable('RIPTIDE_DAEMON_TOKEN_PUBLIC_KEY')

		// Assume it is a public key PEM
		return {
			publicKeyPem: Buffer.from(base64EncodedPublicKey, 'base64').toString('utf-8'),
		}
	}),
)
