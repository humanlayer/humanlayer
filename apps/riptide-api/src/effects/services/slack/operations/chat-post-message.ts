import { Effect, Redacted } from 'effect'
import * as HttpClientRequest from 'effect/http/HttpClientRequest'

import { SlackHttpClient } from '../slack-http-client.service'
import { decodeSlackResponse } from '../slack-response'
import { SlackUnexpectedResponseError } from '../slack.errors'
import { SlackPostMessageRequestSchema, SlackPostMessageResponseSchema } from '../slack.schema'
import type { SlackPostMessageResponse } from '../slack.schema'
import type { SlackBlock, SlackProviderError } from '../slack.types'

export type SlackChatPostMessageInput = {
	botToken: Redacted.Redacted<string>
	channelId: string
	blocks: SlackBlock[]
	threadTs?: string
	broadcast?: boolean
}
export type SlackChatPostMessageResult = SlackPostMessageResponse & { readonly ts: string }

type SlackChatPostMessageBody = {
	channel: string
	blocks: SlackBlock[]
	unfurl_links: boolean
	unfurl_media: boolean
	thread_ts?: string
	reply_broadcast?: boolean
}

export const chatPostMessage: (
	input: SlackChatPostMessageInput,
) => Effect.Effect<SlackChatPostMessageResult, SlackProviderError, SlackHttpClient> = Effect.fn(
	'slack.api.chat_post_message',
)(function* (input) {
	const slackHttp = yield* SlackHttpClient
	const body: SlackChatPostMessageBody = {
		channel: input.channelId,
		blocks: input.blocks,
		unfurl_links: false,
		unfurl_media: false,
	}
	if (input.threadTs) {
		body.thread_ts = input.threadTs
		body.reply_broadcast = input.broadcast ?? false
	}
	const request = yield* HttpClientRequest.schemaBodyJson(SlackPostMessageRequestSchema)(body)(
		HttpClientRequest.post('/api/chat.postMessage').pipe(HttpClientRequest.bearerToken(input.botToken)),
	).pipe(Effect.mapError((cause) => new SlackUnexpectedResponseError({ cause })))
	const response = yield* slackHttp
		.execute(request)
		.pipe(
			Effect.flatMap((response) =>
				decodeSlackResponse(response, SlackPostMessageResponseSchema, { channelId: input.channelId }),
			),
		)
	if (!response.ts) return yield* Effect.fail(new SlackUnexpectedResponseError({ cause: response }))
	yield* Effect.annotateCurrentSpan({ channel_id: input.channelId })
	return { ...response, ts: response.ts }
})
