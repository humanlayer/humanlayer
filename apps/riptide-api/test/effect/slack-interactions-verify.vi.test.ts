import { describe, it } from '@effect/vitest'
import { ConfigProvider, Effect, Layer } from 'effect'
import * as HttpClient from 'effect/http/HttpClient'
import { TestClock } from 'effect/testing'
import { expect } from 'vitest'

import {
	SlackWebhookMalformedRequestError,
	SlackWebhookRequestTooOldError,
	SlackWebhookSignatureInvalidError,
} from '../../src/effects/services/slack/slack.errors'
import { computeSlackSignature } from '../../src/effects/services/slack/slack.interactions'
import { SlackService, SlackServiceLiveBase } from '../../src/effects/services/slack/slack.service'

// The signing secret the injected service verifies against. Self-signed cases below
// exercise the real recipe (they are not mocks): we own this secret, so we can produce
// signatures the verifier accepts or rejects. Recipe *correctness* (that our recipe
// matches Slack's) is anchored separately by the golden vector in case (A).
const SLACK_SIGNING_SECRET = 'test-slack-signing-secret'

// Slack's published request-verification known-answer vector.
// https://docs.slack.dev/authentication/verifying-requests-from-slack/
const GOLDEN_SIGNING_SECRET = '8f742231b10e8888abcd99yyyzzz85a5'
const GOLDEN_TIMESTAMP = '1531420618'
const GOLDEN_BODY =
	'token=xyzz0WbapA4vBCDEFasx0q6G&team_id=T1DC2JH3J&team_domain=testteamnow&channel_id=G8PSS9T3V&channel_name=foobar&user_id=U2CERLKJA&user_name=roadrunner&command=%2Fwebhook-collect&text=&response_url=https%3A%2F%2Fhooks.slack.com%2Fcommands%2FT1DC2JH3J%2F397700885554%2F96rGlfmibIGlgcZRskXaIFfN&trigger_id=398738663015.47445629121.803a0bc887a14d10d2c447fce8b6703c'
const GOLDEN_SIGNATURE = 'v0=a2114d57b48eac39b9ad189dd8316235a7b4a8d21a10bd27519666489c69b503'

// The docs vector is from 2018, so the 5-minute replay window would reject it unless
// the clock is pinned near that timestamp. `it.effect` uses the default TestClock
// (epoch 0), so the accepted-through-the-service cases set the clock explicitly.
const GOLDEN_TIMESTAMP_MILLIS = Number(GOLDEN_TIMESTAMP) * 1000

const configLayer = ConfigProvider.layer(
	ConfigProvider.fromUnknown({
		SLACK_CLIENT_ID: 'client-id',
		SLACK_CLIENT_SECRET: 'client-secret',
		SLACK_APP_ID: 'app-id',
		SLACK_SIGNING_SECRET,
		SLACK_API_BASE_URL: 'https://slack.test',
		SLACK_OAUTH_REDIRECT_URL: 'https://api.example.test/integrations/slack/callback',
		APP_ORIGIN: 'https://app.example.test',
	}),
)

// Neither service method touches HTTP, but SlackServiceLiveBase requires an HttpClient
// to build its SDK client. This fake satisfies the layer and is never invoked.
const fakeHttpClientLayer = Layer.succeed(
	HttpClient.HttpClient,
	HttpClient.make(() => Effect.die('HttpClient must not be called by interaction verification')),
)

const makeLayer = () => SlackServiceLiveBase.pipe(Layer.provide(Layer.mergeAll(configLayer, fakeHttpClientLayer)))

/** Builds the headers Slack sends, signing `rawBody` at `timestamp` with `secret`. */
function signedHeaders(input: { rawBody: string; timestamp: string; secret?: string }): Headers {
	const signature = computeSlackSignature({
		signingSecret: input.secret ?? SLACK_SIGNING_SECRET,
		timestamp: input.timestamp,
		rawBody: input.rawBody,
	})
	return new Headers({
		'X-Slack-Signature': signature,
		'X-Slack-Request-Timestamp': input.timestamp,
	})
}

/** A minimal but realistic `block_actions` interaction body (URL-encoded `payload`). */
function blockActionsBody(): string {
	const payload = {
		type: 'block_actions',
		team: { id: 'T123' },
		user: { id: 'U456' },
		channel: { id: 'C789' },
		message: { ts: '1700000000.000100' },
		actions: [{ action_id: 'view_artifact', value: 'artifact-1' }],
		response_url: 'https://hooks.slack.com/actions/T123/456/abc',
	}
	return new URLSearchParams({ payload: JSON.stringify(payload) }).toString()
}

describe('SlackService.verifyInteractionRequest', () => {
	// (A) Golden vector — pure signer, no Effect, no clock. The non-circular anchor:
	// our recipe reproduces Slack's documented digest exactly. Not an `it.effect` — the
	// signer is a plain function, and this test asserts recipe correctness independently
	// of the service seam.
	it('reproduces Slack’s golden known-answer signature (pure signer)', () => {
		const signature = computeSlackSignature({
			signingSecret: GOLDEN_SIGNING_SECRET,
			timestamp: GOLDEN_TIMESTAMP,
			rawBody: GOLDEN_BODY,
		})
		expect(signature).toBe(GOLDEN_SIGNATURE)
	})

	// (A′) Golden-era acceptance through the service. Pin the TestClock near the 2018
	// docs timestamp so the freshness window does not reject it, then verify a real
	// interaction body signed with the injected secret is accepted and parsed.
	it.effect('accepts a request signed at the pinned docs timestamp', ({ expect }) =>
		Effect.gen(function* () {
			yield* TestClock.setTime(GOLDEN_TIMESTAMP_MILLIS)
			const rawBody = blockActionsBody()
			const slack = yield* SlackService
			const payload = yield* slack.verifyInteractionRequest({
				rawBody,
				headers: signedHeaders({ rawBody, timestamp: GOLDEN_TIMESTAMP }),
			})
			expect(payload.type).toBe('block_actions')
			expect(payload.actions?.[0]?.action_id).toBe('view_artifact')
		}).pipe(Effect.provide(makeLayer())),
	)

	// Happy self-signed: sign with the injected secret at a timestamp matching the
	// pinned clock → returns the parsed payload (exercises the real recipe).
	it.effect('returns the parsed payload for a valid self-signed request', ({ expect }) =>
		Effect.gen(function* () {
			const timestampSeconds = 1_700_000_000
			yield* TestClock.setTime(timestampSeconds * 1000)
			const rawBody = blockActionsBody()
			const slack = yield* SlackService
			const payload = yield* slack.verifyInteractionRequest({
				rawBody,
				headers: signedHeaders({ rawBody, timestamp: String(timestampSeconds) }),
			})
			expect(payload.type).toBe('block_actions')
			expect(payload.channel?.id).toBe('C789')
		}).pipe(Effect.provide(makeLayer())),
	)

	// (C) Replay window: a validly-signed request whose timestamp is 10 minutes old is
	// rejected with SlackWebhookRequestTooOldError, independent of signature validity.
	it.effect('rejects a stale timestamp with SlackWebhookRequestTooOldError', ({ expect }) =>
		Effect.gen(function* () {
			const timestampSeconds = 1_700_000_000
			// Clock is 10 minutes after the signed timestamp (window is 5 minutes).
			yield* TestClock.setTime((timestampSeconds + 600) * 1000)
			const rawBody = blockActionsBody()
			const slack = yield* SlackService
			const error = yield* slack
				.verifyInteractionRequest({
					rawBody,
					headers: signedHeaders({ rawBody, timestamp: String(timestampSeconds) }),
				})
				.pipe(Effect.flip)
			expect(error).toBeInstanceOf(SlackWebhookRequestTooOldError)
		}).pipe(Effect.provide(makeLayer())),
	)

	// Malformed: a correctly-signed body whose `payload` field is missing / invalid JSON
	// → SlackWebhookMalformedRequestError (the request was authentic, the body was not).
	it.effect('rejects a correctly-signed body with no payload field as malformed', ({ expect }) =>
		Effect.gen(function* () {
			const timestampSeconds = 1_700_000_000
			yield* TestClock.setTime(timestampSeconds * 1000)
			const rawBody = 'token=abc&team_id=T123' // authentic bytes, but no `payload`
			const slack = yield* SlackService
			const error = yield* slack
				.verifyInteractionRequest({
					rawBody,
					headers: signedHeaders({ rawBody, timestamp: String(timestampSeconds) }),
				})
				.pipe(Effect.flip)
			expect(error).toBeInstanceOf(SlackWebhookMalformedRequestError)
		}).pipe(Effect.provide(makeLayer())),
	)

	it.effect('rejects a correctly-signed body with invalid payload JSON as malformed', ({ expect }) =>
		Effect.gen(function* () {
			const timestampSeconds = 1_700_000_000
			yield* TestClock.setTime(timestampSeconds * 1000)
			const rawBody = new URLSearchParams({ payload: '{not valid json' }).toString()
			const slack = yield* SlackService
			const error = yield* slack
				.verifyInteractionRequest({
					rawBody,
					headers: signedHeaders({ rawBody, timestamp: String(timestampSeconds) }),
				})
				.pipe(Effect.flip)
			expect(error).toBeInstanceOf(SlackWebhookMalformedRequestError)
		}).pipe(Effect.provide(makeLayer())),
	)

	// Tampered body: sign body A, deliver body B → the recomputed signature mismatches.
	it.effect('rejects a tampered body with SlackWebhookSignatureInvalidError', ({ expect }) =>
		Effect.gen(function* () {
			const timestampSeconds = 1_700_000_000
			yield* TestClock.setTime(timestampSeconds * 1000)
			const signedBody = blockActionsBody()
			const headers = signedHeaders({ rawBody: signedBody, timestamp: String(timestampSeconds) })
			const deliveredBody = new URLSearchParams({
				payload: JSON.stringify({ type: 'block_actions', tampered: true }),
			}).toString()
			const slack = yield* SlackService
			const error = yield* slack.verifyInteractionRequest({ rawBody: deliveredBody, headers }).pipe(Effect.flip)
			expect(error).toBeInstanceOf(SlackWebhookSignatureInvalidError)
		}).pipe(Effect.provide(makeLayer())),
	)

	it.effect('rejects a missing signature header with SlackWebhookSignatureInvalidError', ({ expect }) =>
		Effect.gen(function* () {
			const rawBody = blockActionsBody()
			const slack = yield* SlackService
			const error = yield* slack
				.verifyInteractionRequest({
					rawBody,
					headers: new Headers({ 'X-Slack-Request-Timestamp': '1700000000' }),
				})
				.pipe(Effect.flip)
			expect(error).toBeInstanceOf(SlackWebhookSignatureInvalidError)
		}).pipe(Effect.provide(makeLayer())),
	)

	it.effect('rejects a missing timestamp header with SlackWebhookSignatureInvalidError', ({ expect }) =>
		Effect.gen(function* () {
			const rawBody = blockActionsBody()
			const slack = yield* SlackService
			const error = yield* slack
				.verifyInteractionRequest({
					rawBody,
					headers: new Headers({ 'X-Slack-Signature': 'v0=deadbeef' }),
				})
				.pipe(Effect.flip)
			expect(error).toBeInstanceOf(SlackWebhookSignatureInvalidError)
		}).pipe(Effect.provide(makeLayer())),
	)
})

describe('SlackService.handleInteractionPayload', () => {
	// Proves the `never` channel: a degenerate payload with only the required `type`
	// field still succeeds (no throw, no fail).
	it.effect('succeeds on a degenerate payload (never error channel)', () =>
		Effect.gen(function* () {
			const slack = yield* SlackService
			yield* slack.handleInteractionPayload({ type: 'block_actions' })
		}).pipe(Effect.provide(makeLayer())),
	)
})
