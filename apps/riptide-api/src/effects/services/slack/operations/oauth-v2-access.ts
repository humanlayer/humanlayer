import { Effect, Redacted } from 'effect'
import * as HttpClientRequest from 'effect/http/HttpClientRequest'

import { SlackHttpClient } from '../slack-http-client.service'
import { decodeSlackResponse } from '../slack-response'
import { SlackUnexpectedResponseError } from '../slack.errors'
import { SlackOAuthAccessResponseSchema } from '../slack.schema'
import type { SlackOAuthAccessResponse } from '../slack.schema'
import type { SlackProviderError } from '../slack.types'

export type SlackOAuthV2AccessInput = {
	clientId: string
	clientSecret: Redacted.Redacted<string>
	code: Redacted.Redacted<string>
	redirectUri: string
}
export type SlackOAuthV2AccessResult = SlackOAuthAccessResponse & {
	readonly access_token: NonNullable<SlackOAuthAccessResponse['access_token']>
	readonly bot_user_id: string
}

export const oauthV2Access: (
	input: SlackOAuthV2AccessInput,
) => Effect.Effect<SlackOAuthV2AccessResult, SlackProviderError, SlackHttpClient> = Effect.fn(
	'slack.api.oauth_v2_access',
)(function* (input) {
	const slackHttp = yield* SlackHttpClient
	const request = HttpClientRequest.post('/api/oauth.v2.access').pipe(
		HttpClientRequest.bodyUrlParams({
			client_id: input.clientId,
			client_secret: Redacted.value(input.clientSecret),
			code: Redacted.value(input.code),
			redirect_uri: input.redirectUri,
			grant_type: 'authorization_code',
		}),
	)
	const response = yield* slackHttp
		.execute(request)
		.pipe(
			Effect.flatMap((response) =>
				decodeSlackResponse(response, SlackOAuthAccessResponseSchema, { oauth: true }),
			),
		)
	if (!response.access_token || !response.bot_user_id)
		return yield* Effect.fail(new SlackUnexpectedResponseError({ code: response.error, cause: response }))
	return { ...response, access_token: response.access_token, bot_user_id: response.bot_user_id }
})
