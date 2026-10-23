import { createServer } from 'node:net'

import { describe, it } from '@effect/vitest'
import { ConfigProvider, Effect, Layer, Redacted, Result } from 'effect'
import * as FetchHttpClient from 'effect/http/FetchHttpClient'
import * as Schema from 'effect/Schema'
import { createEmulator, type Emulator } from 'emulate'
import { afterAll, beforeAll, beforeEach, expect } from 'vitest'

import { SlackHttpClientLive } from '../../src/effects/services/slack/slack-http-client.layer'
import { SlackProviderClient, SlackProviderClientLive } from '../../src/effects/services/slack/slack.client'
import { SlackMissingScopeError } from '../../src/effects/services/slack/slack.errors'

const BOT_TOKEN = 'xoxb-emulator-full-access'
const LIMITED_TOKEN = 'xoxb-emulator-limited-access'
const OAUTH_CLIENT_ID = 'emulator-client-id'
const OAUTH_CLIENT_SECRET = 'emulator-client-secret'
const OAUTH_REDIRECT_URL = 'http://localhost/integrations/slack/callback'
const PUBLIC_CHANNEL_COUNT = 205
const publicChannels = Array.from({ length: PUBLIC_CHANNEL_COUNT }, (_, index) => ({
	name: `public-${String(index + 1).padStart(3, '0')}`,
}))

describe('Slack provider against the Slack emulator', () => {
	let emulator: Emulator
	let slackProviderLayer: ReturnType<typeof makeSlackProviderLayer>

	beforeAll(async () => {
		const port = await reserveAvailablePort()
		emulator = await createEmulator({
			service: 'slack',
			port,
			seed: {
				slack: {
					team: { name: 'Riptide Test Workspace', domain: 'riptide-test' },
					users: [{ name: 'riptide-tester', real_name: 'Riptide Tester' }],
					channels: [...publicChannels, { name: 'late-private', is_private: true }],
					tokens: [
						{
							token: BOT_TOKEN,
							user: 'riptide-tester',
							scopes: ['chat:write', 'channels:read', 'channels:history', 'groups:read'],
						},
						{ token: LIMITED_TOKEN, user: 'riptide-tester', scopes: ['chat:write'] },
					],
					oauth_apps: [
						{
							client_id: OAUTH_CLIENT_ID,
							client_secret: OAUTH_CLIENT_SECRET,
							app_id: 'A_RIPTIDE_TEST',
							name: 'Riptide Test App',
							redirect_uris: [OAUTH_REDIRECT_URL],
							scopes: ['chat:write', 'channels:read', 'groups:read'],
							bot_name: 'riptide-bot',
						},
					],
					strict_scopes: true,
				},
			},
		})

		slackProviderLayer = makeSlackProviderLayer(emulator.url)
	})

	beforeEach(() => emulator.reset())

	afterAll(async () => {
		await emulator?.close()
	})

	it.effect('loads every channel across multiple emulator pages', () =>
		Effect.gen(function* () {
			const slack = yield* SlackProviderClient
			const channels = yield* slack.paginateChannels(Redacted.make(BOT_TOKEN))

			// The emulator always includes its default general and random channels in addition to our seed.
			expect(channels).toHaveLength(PUBLIC_CHANNEL_COUNT + 3)
			expect(channels).toContainEqual(expect.objectContaining({ name: 'public-001' }))
			expect(channels.at(-1)).toMatchObject({ name: 'late-private', isPrivate: true })
		}).pipe(Effect.provide(slackProviderLayer)),
	)

	it.effect('posts a message that is visible in emulator channel history', () =>
		Effect.gen(function* () {
			const slack = yield* SlackProviderClient
			const channels = yield* slack.paginateChannels(Redacted.make(BOT_TOKEN))
			const channel = channels[0]
			if (!channel) return yield* Effect.die('Expected a seeded Slack channel')

			const posted = yield* slack.postMessage({
				botToken: Redacted.make(BOT_TOKEN),
				channelId: channel.id,
				blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'Hello from Riptide' } }],
			})
			const history = yield* Effect.promise(() => readChannelHistory(emulator.url, channel.id))

			expect(posted.ts).toBeTruthy()
			expect(history.messages).toContainEqual(
				expect.objectContaining({
					ts: posted.ts,
					blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'Hello from Riptide' } }],
				}),
			)
		}).pipe(Effect.provide(slackProviderLayer)),
	)

	it.effect('returns a typed missing-scope error from the emulator', () =>
		Effect.gen(function* () {
			const slack = yield* SlackProviderClient
			const result = yield* Effect.result(slack.paginateChannels(Redacted.make(LIMITED_TOKEN)))

			expect(Result.isFailure(result)).toBe(true)
			if (Result.isFailure(result)) expect(result.failure).toBeInstanceOf(SlackMissingScopeError)
		}).pipe(Effect.provide(slackProviderLayer)),
	)

	it.effect('exchanges an emulator OAuth code for a Slack installation', () =>
		Effect.gen(function* () {
			const slack = yield* SlackProviderClient
			const code = yield* Effect.promise(() => createOAuthCode(emulator.url))
			const response = yield* slack.exchangeOAuthCode({ code })
			const accessToken = response.access_token
			if (!accessToken) return yield* Effect.die('Expected Slack OAuth to return an access token')

			expect(Redacted.value(accessToken)).toMatch(/^xoxb-/)
			expect(response.bot_user_id).toBeTruthy()
			expect(response.team?.name).toBe('Riptide Test Workspace')
		}).pipe(Effect.provide(slackProviderLayer)),
	)
})

const makeSlackProviderLayer = (slackApiBaseUrl: string) => {
	const configLayer = ConfigProvider.layer(
		ConfigProvider.fromUnknown({
			SLACK_API_BASE_URL: slackApiBaseUrl,
			SLACK_CLIENT_ID: OAUTH_CLIENT_ID,
			SLACK_CLIENT_SECRET: OAUTH_CLIENT_SECRET,
			SLACK_OAUTH_REDIRECT_URL: OAUTH_REDIRECT_URL,
		}),
	)
	const configuredProvider = SlackProviderClientLive.pipe(Layer.provide(SlackHttpClientLive))
	return configuredProvider.pipe(Layer.provide(Layer.mergeAll(configLayer, FetchHttpClient.layer)))
}

const SlackEmulatorHistorySchema = Schema.Struct({
	messages: Schema.Array(
		Schema.Struct({ ts: Schema.optional(Schema.String), blocks: Schema.optional(Schema.Unknown) }),
	),
})

const SlackEmulatorAuthTestSchema = Schema.Struct({ user_id: Schema.String })

const readChannelHistory = async (baseUrl: string, channelId: string) => {
	const response = await fetch(`${baseUrl}/api/conversations.history`, {
		method: 'POST',
		headers: { authorization: `Bearer ${BOT_TOKEN}`, 'content-type': 'application/json' },
		body: JSON.stringify({ channel: channelId }),
	})
	if (!response.ok) throw new Error(`Slack emulator history request failed with HTTP ${response.status}`)
	return Schema.decodeUnknownPromise(SlackEmulatorHistorySchema)(await response.json())
}

const createOAuthCode = async (baseUrl: string): Promise<string> => {
	const authResponse = await fetch(`${baseUrl}/api/auth.test`, {
		method: 'POST',
		headers: { authorization: `Bearer ${BOT_TOKEN}` },
	})
	const { user_id: userId } = await Schema.decodeUnknownPromise(SlackEmulatorAuthTestSchema)(
		await authResponse.json(),
	)
	const callbackResponse = await fetch(`${baseUrl}/oauth/v2/authorize/callback`, {
		method: 'POST',
		redirect: 'manual',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			user_id: userId,
			redirect_uri: OAUTH_REDIRECT_URL,
			scope: 'chat:write,channels:read,groups:read',
			state: 'emulator-state',
			client_id: OAUTH_CLIENT_ID,
		}),
	})
	const location = callbackResponse.headers.get('location')
	const code = location ? new URL(location).searchParams.get('code') : null
	if (!code) throw new Error('Slack emulator did not return an OAuth code')
	return code
}

const reserveAvailablePort = (): Promise<number> =>
	new Promise((resolve, reject) => {
		const server = createServer()
		server.once('error', reject)
		server.listen(0, '127.0.0.1', () => {
			const address = server.address()
			if (!address || typeof address === 'string') {
				server.close()
				reject(new Error('Unable to reserve a port for the Slack emulator'))
				return
			}
			server.close((error) => (error ? reject(error) : resolve(address.port)))
		})
	})
