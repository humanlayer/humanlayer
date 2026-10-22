import { describe, it } from '@effect/vitest'
import { Effect, Result } from 'effect'

import { classifyBody } from '../../src/effects/services/slack/classify'
import {
	SlackApiUnavailableError,
	SlackChannelNotFoundError,
	SlackMissingScopeError,
	SlackNotInChannelError,
	SlackOAuthError,
	SlackRateLimitError,
	SlackTokenRevokedError,
	SlackUnexpectedResponseError,
} from '../../src/effects/services/slack/slack.errors'

describe('Slack classifiers', () => {
	const bodyCases = [
		['token_revoked', SlackTokenRevokedError],
		['invalid_auth', SlackTokenRevokedError],
		['not_authed', SlackTokenRevokedError],
		['account_inactive', SlackTokenRevokedError],
		['missing_scope', SlackMissingScopeError],
		['not_in_channel', SlackNotInChannelError],
		['channel_not_found', SlackChannelNotFoundError],
		['is_archived', SlackChannelNotFoundError],
		['ratelimited', SlackRateLimitError],
		['unknown_problem', SlackUnexpectedResponseError],
	] as const

	for (const [code, ErrorClass] of bodyCases) {
		it.effect(`maps Slack body error ${code}`, ({ expect }) =>
			Effect.gen(function* () {
				const result = yield* Effect.result(
					classifyBody(
						{ ok: false, error: code, needed: 'channels:read', provided: 'chat:write' },
						{ channelId: 'C123' },
					),
				)

				expect(Result.isFailure(result)).toBe(true)
				if (Result.isFailure(result)) expect(result.failure).toBeInstanceOf(ErrorClass)
			}),
		)
	}

	it.effect('maps OAuth body errors to OAuth errors in OAuth context', ({ expect }) =>
		Effect.gen(function* () {
			const result = yield* Effect.result(classifyBody({ ok: false, error: 'invalid_code' }, { oauth: true }))

			expect(Result.isFailure(result)).toBe(true)
			if (Result.isFailure(result)) expect(result.failure).toBeInstanceOf(SlackOAuthError)
		}),
	)

	it.effect('passes successful Slack bodies through', ({ expect }) =>
		Effect.gen(function* () {
			const body = { ok: true, ts: '111.1' }
			const result = yield* classifyBody(body)

			expect(result).toBe(body)
		}),
	)
})
