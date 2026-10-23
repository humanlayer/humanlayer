import { WorkOS } from '@workos-inc/node'
import { Context, Effect, Layer, Redacted } from 'effect'

import { EnvironmentVariable } from '@/lib/effect/environment'

/**
 * Define the Workos Config Services used for creating other services that depend on workos stuf
 */
export class WorkosConfig extends Context.Service<
	WorkosConfig,
	{
		workosClientId: string
		workosRedirectUri: string
		workos: WorkOS
		jwksUrl: string
	}
>()('WorkosConfig') {}

/**
 * This is the workos layer which implements the service definition WorkosConfig
 * distinct e.g. from WorkosConfigTest  - this is the correct effect idiom
 */
export const WorkosConfigLive = Layer.effect(
	WorkosConfig,
	Effect.gen(function* () {
		// do effectful things to build it
		const workosClientId = yield* EnvironmentVariable('WORKOS_CLIENT_ID')
		const workosRedirectUri = yield* EnvironmentVariable('WORKOS_REDIRECT_URI')
		const workosApiKey = yield* EnvironmentVariable('WORKOS_API_KEY').pipe(Effect.map(Redacted.make))

		const workos = new WorkOS(Redacted.value(workosApiKey))

		return {
			workosClientId,
			workosRedirectUri,
			workos,
			jwksUrl: workos.userManagement.getJwksUrl(workosClientId),
		}
	}),
)
