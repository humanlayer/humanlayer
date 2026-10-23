import { Config, Context, Effect, Layer, type Redacted } from 'effect'

export type ResendConfigShape = {
	apiKey: Redacted.Redacted<string>
	apiBaseUrl: string
	fromEmail: string
	cloudOrigin: string
	appOrigin: string
}

/**
 * Configuration for the Resend email service.
 * Loads from environment variables. The fetch seam can be overridden for tests.
 */
export class ResendConfig extends Context.Service<ResendConfig, ResendConfigShape>()('ResendConfig') {}

export const ResendConfigLive = Layer.effect(
	ResendConfig,
	Effect.gen(function* () {
		const apiKey = yield* Config.Redacted('RESEND_API_KEY')
		const apiBaseUrl = yield* Config.String('RESEND_API_BASE_URL').pipe(
			Config.withDefault('https://api.resend.com'),
		)
		const fromEmail = yield* Config.String('RESEND_FROM_EMAIL')
		const cloudOrigin = yield* Config.String('CLOUD_ORIGIN')
		const appOrigin = yield* Config.String('APP_ORIGIN')

		return {
			apiKey,
			apiBaseUrl,
			fromEmail,
			cloudOrigin,
			appOrigin,
		}
	}),
)
