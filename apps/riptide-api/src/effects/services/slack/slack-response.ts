import { Effect, Option } from 'effect'
import type * as HttpClientResponse from 'effect/http/HttpClientResponse'
import * as Schema from 'effect/Schema'

import { classifySlackApiResponse } from './classify'
import {
	SlackApiUnavailableError,
	SlackRateLimitError,
	SlackTokenRevokedError,
	SlackUnexpectedResponseError,
} from './slack.errors'
import type { SlackProviderError } from './slack.types'

export const decodeSlackResponse = <A extends { readonly ok: boolean; readonly error?: string }>(
	response: HttpClientResponse.HttpClientResponse,
	schema: Schema.ConstraintDecoder<A, never>,
	context: { channelId?: string; oauth?: boolean } = {},
): Effect.Effect<A, SlackProviderError> => {
	if (response.status === 429) {
		const retryAfterMs = Option.getOrUndefined(
			Schema.decodeUnknownOption(Schema.NumberFromString)(response.headers['retry-after']),
		)
		return Effect.fail(new SlackRateLimitError({ retryAfterMs: retryAfterMs && retryAfterMs * 1_000 }))
	}
	if (response.status === 401 || response.status === 403)
		return Effect.fail(new SlackTokenRevokedError({ code: `http_${response.status}` }))
	if (response.status < 200 || response.status >= 300)
		return Effect.fail(
			response.status >= 500
				? new SlackApiUnavailableError({ cause: { status: response.status } })
				: new SlackUnexpectedResponseError({
						code: `http_${response.status}`,
						cause: { status: response.status },
					}),
		)

	return response.json.pipe(
		Effect.mapError((cause) => new SlackUnexpectedResponseError({ cause })),
		Effect.flatMap((json) =>
			Schema.decodeUnknownEffect(schema)(json).pipe(
				Effect.mapError((cause) => new SlackUnexpectedResponseError({ cause })),
			),
		),
		Effect.flatMap(classifySlackApiResponse(context)),
	)
}
