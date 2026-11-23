import { Config, Context, Effect, Layer, Redacted } from 'effect'

import { Sentry } from '../../../instrument'
import { chatPostMessage } from './operations/chat-post-message'
import { conversationsList } from './operations/conversations-list'
import { oauthV2Access } from './operations/oauth-v2-access'
import { SlackHttpClient } from './slack-http-client.service'
import type { SlackChannel, SlackClientConfig, SlackSdkClient } from './slack.types'

export class SlackProviderClient extends Context.Service<SlackProviderClient, SlackSdkClient>()(
	'SlackProviderClient',
) {}

const observeSlackProviderFailure = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
	effect.pipe(
		Effect.tapError((error) => Effect.logError('Slack provider operation failed', error)),
		Effect.tapError((error) => Effect.sync(() => Sentry.captureException(error))),
	)

/**
 * Builds the Slack provider client from credentials the caller already read. `SlackService` reads
 * the SLACK_* key group once, decides whether Slack is set up, and only then builds this client,
 * so a deployment without Slack never reads SLACK_CLIENT_ID or SLACK_CLIENT_SECRET here.
 */
export const makeSlackProviderClient = (config: SlackClientConfig) =>
	Effect.gen(function* () {
		const slackHttp = yield* SlackHttpClient
		const provideHttp = <A, E>(effect: Effect.Effect<A, E, SlackHttpClient>) =>
			// eslint-disable-next-line anti-slop/no-reprovide-ambient-service -- The provider client closes over the application-scoped transport so its public methods have no transport requirement.
			effect.pipe(Effect.provideService(SlackHttpClient, slackHttp), observeSlackProviderFailure)

		const paginateChannels = (
			botToken: Redacted.Redacted<string>,
			cursor?: string,
			seenCursors = new Set<string>(),
		): ReturnType<SlackSdkClient['paginateChannels']> =>
			provideHttp(conversationsList({ botToken, cursor })).pipe(
				Effect.flatMap((response) => {
					const channels: readonly SlackChannel[] = response.channels.map((channel) => ({
						id: channel.id,
						name: channel.name,
						isPrivate: channel.is_private,
					}))
					const nextCursor = response.response_metadata?.next_cursor?.trim()
					if (!nextCursor || seenCursors.has(nextCursor)) return Effect.succeed(channels)
					const nextSeenCursors = new Set(seenCursors)
					nextSeenCursors.add(nextCursor)
					return paginateChannels(botToken, nextCursor, nextSeenCursors).pipe(
						Effect.map((next) => [...channels, ...next]),
					)
				}),
			)

		return SlackProviderClient.of({
			exchangeOAuthCode: ({ code }) =>
				provideHttp(
					oauthV2Access({
						clientId: config.clientId,
						clientSecret: config.clientSecret,
						code: Redacted.make(code),
						redirectUri: config.oauthRedirectUrl,
					}),
				),
			postMessage: (input) => provideHttp(chatPostMessage(input)).pipe(Effect.map(({ ts }) => ({ ts }))),
			paginateChannels,
		})
	})

/** Reads its own credentials. Production builds the client through `SlackService` instead. */
export const SlackProviderClientLive = Layer.effect(
	SlackProviderClient,
	Effect.gen(function* () {
		const config: SlackClientConfig = {
			clientId: yield* Config.String('SLACK_CLIENT_ID'),
			clientSecret: yield* Config.Redacted('SLACK_CLIENT_SECRET'),
			oauthRedirectUrl: yield* Config.String('SLACK_OAUTH_REDIRECT_URL').pipe(
				Config.withDefault(
					new URL(
						'/integrations/slack/callback',
						yield* Config.URL('RIPTIDE_API_ORIGIN').pipe(
							Config.withDefault(new URL('http://localhost:8700')),
						),
					).toString(),
				),
			),
		}
		return yield* makeSlackProviderClient(config)
	}),
)
