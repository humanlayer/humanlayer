import { Effect, Redacted } from 'effect'
import * as HttpClientRequest from 'effect/http/HttpClientRequest'

import { SlackHttpClient } from '../slack-http-client.service'
import { decodeSlackResponse } from '../slack-response'
import { SlackUnexpectedResponseError } from '../slack.errors'
import { SlackConversationsListResponseSchema } from '../slack.schema'
import type { SlackConversationsListResponse } from '../slack.schema'
import type { SlackProviderError } from '../slack.types'

export type SlackConversationsListInput = { botToken: Redacted.Redacted<string>; cursor?: string }
export type SlackConversationsListResult = SlackConversationsListResponse & {
	readonly channels: NonNullable<SlackConversationsListResponse['channels']>
}
type SlackConversationsListForm = { types: string; limit: number; cursor?: string }

export const conversationsList: (
	input: SlackConversationsListInput,
) => Effect.Effect<SlackConversationsListResult, SlackProviderError, SlackHttpClient> = Effect.fn(
	'slack.api.conversations_list',
)(function* (input) {
	const slackHttp = yield* SlackHttpClient
	const params: SlackConversationsListForm = { types: 'public_channel,private_channel', limit: 200 }
	if (input.cursor) params.cursor = input.cursor
	const request = HttpClientRequest.post('/api/conversations.list').pipe(
		HttpClientRequest.bearerToken(input.botToken),
		HttpClientRequest.bodyUrlParams(params),
	)
	const response = yield* slackHttp
		.execute(request)
		.pipe(Effect.flatMap((response) => decodeSlackResponse(response, SlackConversationsListResponseSchema)))
	if (!response.channels) return yield* Effect.fail(new SlackUnexpectedResponseError({ cause: response }))
	yield* Effect.annotateCurrentSpan({ has_cursor: Boolean(input.cursor) })
	return { ...response, channels: response.channels }
})
