import { Effect } from 'effect'

import {
	SlackChannelNotFoundError,
	SlackMissingScopeError,
	SlackNotInChannelError,
	SlackOAuthError,
	SlackRateLimitError,
	SlackTokenRevokedError,
	SlackUnexpectedResponseError,
} from './slack.errors'
import type { SlackApiResponseBody, SlackClassifyContext, SlackProviderError } from './slack.types'

export const classifySlackApiResponse =
	(context: SlackClassifyContext = {}) =>
	<T extends SlackApiResponseBody>(response: T): Effect.Effect<T, SlackProviderError> => {
		if (response.ok !== false && response.error == null) return Effect.succeed(response)
		switch (response.error) {
			case 'token_revoked':
			case 'invalid_auth':
			case 'not_authed':
			case 'account_inactive':
				return Effect.fail(new SlackTokenRevokedError({ code: response.error }))
			case 'missing_scope':
				return Effect.fail(new SlackMissingScopeError({ needed: response.needed, provided: response.provided }))
			case 'not_in_channel':
				return Effect.fail(
					new SlackNotInChannelError({ channelId: context.channelId ?? '', code: response.error }),
				)
			case 'channel_not_found':
			case 'is_archived':
				return Effect.fail(
					new SlackChannelNotFoundError({ channelId: context.channelId ?? '', code: response.error }),
				)
			case 'ratelimited':
				return Effect.fail(new SlackRateLimitError({}))
			case 'invalid_code':
			case 'bad_redirect_uri':
				return context.oauth
					? Effect.fail(new SlackOAuthError({ code: response.error, cause: response }))
					: Effect.fail(new SlackUnexpectedResponseError({ code: response.error, cause: response }))
			default:
				return Effect.fail(new SlackUnexpectedResponseError({ code: response.error, cause: response }))
		}
	}

export const classifyBody = <T extends SlackApiResponseBody>(response: T, context: SlackClassifyContext = {}) =>
	classifySlackApiResponse(context)(response)
