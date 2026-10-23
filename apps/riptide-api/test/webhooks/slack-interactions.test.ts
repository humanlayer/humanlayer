import { ConfigProvider, Effect, Layer } from 'effect'
import * as HttpClient from 'effect/http/HttpClient'
import { afterEach, describe, expect, test } from 'vitest'

import type { AppRuntime } from '../../src/effects/app-runtime'
import { computeSlackSignature } from '../../src/effects/services/slack/slack.interactions'
import { SlackService, SlackServiceLiveBase } from '../../src/effects/services/slack/slack.service'
import type { SlackInteractionPayload } from '../../src/effects/services/slack/slack.types'
import { createMockStripeService, createMockWorkosService } from '../mocks'
import { createApp } from '../test-factory'
import { createRuntimeWithTestPostgresLayer } from '../utils/effect-procedure-test-runtime'

// The route's runtime uses the REAL system clock, so bodies are signed with a *current*
// timestamp: freshness always passes and only the case under test (bad signature, missing
// header, malformed payload) triggers a rejection.
const SLACK_SIGNING_SECRET = 'route-test-slack-signing-secret'

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

// Verification never touches HTTP, but SlackServiceLiveBase builds its SDK client from an
// HttpClient. This fake satisfies the layer and dies if it is ever called.
const fakeHttpClientLayer = Layer.succeed(
	HttpClient.HttpClient,
	HttpClient.make(() => Effect.die('HttpClient must not be called by interaction verification')),
)

// The REAL Slack service (real recipe) provided with the known test secret. `Layer.orDie`
// discharges the residual `ConfigError` (the injected config always decodes, so a failure
// would be a test-setup defect), matching the production `SlackServiceLive.pipe(Layer.orDie)`
// and satisfying the runtime seam's `Layer<SlackService, never>` requirement.
const realSlackLayer = SlackServiceLiveBase.pipe(
	Layer.provide(Layer.mergeAll(configLayer, fakeHttpClientLayer)),
	Layer.orDie,
)

// Runtimes hold live fibers; dispose each after its test so nothing leaks between cases.
const runtimes: AppRuntime[] = []
afterEach(async () => {
	await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()))
})

function makeSlackApp(slack: Layer.Layer<SlackService>) {
	const effectRuntime = createRuntimeWithTestPostgresLayer({} as any, { slack })
	runtimes.push(effectRuntime)
	// `db: {} as any` — the interaction path performs no Postgres work.
	const app = createApp({
		db: {} as any,
		workos: createMockWorkosService(),
		stripe: createMockStripeService(),
		effectRuntime,
	})
	return app
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

/** Current unix seconds — used so the freshness window always passes under the real clock. */
function currentTimestamp(): string {
	return String(Math.floor(Date.now() / 1000))
}

/** Signs `rawBody` at `timestamp` with the test secret and returns Slack's request headers. */
function signedHeaders(input: { rawBody: string; timestamp?: string }): Record<string, string> {
	const timestamp = input.timestamp ?? currentTimestamp()
	const signature = computeSlackSignature({
		signingSecret: SLACK_SIGNING_SECRET,
		timestamp,
		rawBody: input.rawBody,
	})
	return {
		'content-type': 'application/x-www-form-urlencoded',
		'x-slack-signature': signature,
		'x-slack-request-timestamp': timestamp,
	}
}

describe('POST /webhooks/slack/interactions', () => {
	// (E) Happy path through the REAL recipe: a valid self-signed request is ACKed 200.
	test('returns 200 { ok: true } for a valid self-signed request', async () => {
		const app = makeSlackApp(realSlackLayer)
		const body = blockActionsBody()

		const response = await app.request('/webhooks/slack/interactions', {
			method: 'POST',
			headers: signedHeaders({ rawBody: body }),
			body,
		})

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({ ok: true })
	})

	// (E) Missing signature header → 401 (rejected, not ACKed).
	test('returns 401 when the X-Slack-Signature header is missing', async () => {
		const app = makeSlackApp(realSlackLayer)
		const body = blockActionsBody()

		const response = await app.request('/webhooks/slack/interactions', {
			method: 'POST',
			headers: {
				'content-type': 'application/x-www-form-urlencoded',
				'x-slack-request-timestamp': currentTimestamp(),
			},
			body,
		})

		expect(response.status).toBe(401)
		expect(await response.json()).toEqual({ error: 'invalid_request' })
	})

	// (E) Missing timestamp header → 401.
	test('returns 401 when the X-Slack-Request-Timestamp header is missing', async () => {
		const app = makeSlackApp(realSlackLayer)
		const body = blockActionsBody()

		const response = await app.request('/webhooks/slack/interactions', {
			method: 'POST',
			headers: {
				'content-type': 'application/x-www-form-urlencoded',
				'x-slack-signature': 'v0=deadbeef',
			},
			body,
		})

		expect(response.status).toBe(401)
		expect(await response.json()).toEqual({ error: 'invalid_request' })
	})

	// (E) Authentic request, missing `payload` field → 400 (malformed).
	test('returns 400 when the payload form field is missing', async () => {
		const app = makeSlackApp(realSlackLayer)
		const body = 'token=abc&team_id=T123' // correctly signed below, but no `payload`

		const response = await app.request('/webhooks/slack/interactions', {
			method: 'POST',
			headers: signedHeaders({ rawBody: body }),
			body,
		})

		expect(response.status).toBe(400)
		expect(await response.json()).toEqual({ error: 'invalid_request' })
	})

	// (E) Authentic request, invalid JSON in `payload` → 400 (malformed).
	test('returns 400 when the payload JSON is invalid', async () => {
		const app = makeSlackApp(realSlackLayer)
		const body = new URLSearchParams({ payload: '{not valid json' }).toString()

		const response = await app.request('/webhooks/slack/interactions', {
			method: 'POST',
			headers: signedHeaders({ rawBody: body }),
			body,
		})

		expect(response.status).toBe(400)
		expect(await response.json()).toEqual({ error: 'invalid_request' })
	})

	// (B) Tamper: sign body A, deliver body B → the recomputed signature mismatches → 401.
	test('returns 401 when a different body is delivered than was signed', async () => {
		const app = makeSlackApp(realSlackLayer)
		const signedBody = blockActionsBody()
		const headers = signedHeaders({ rawBody: signedBody })
		const deliveredBody = new URLSearchParams({
			payload: JSON.stringify({ type: 'block_actions', tampered: true }),
		}).toString()

		const response = await app.request('/webhooks/slack/interactions', {
			method: 'POST',
			headers,
			body: deliveredBody,
		})

		expect(response.status).toBe(401)
		expect(await response.json()).toEqual({ error: 'invalid_request' })
	})

	// (B) Raw-body regression: sign the exact bytes, deliver a semantically-equal but
	// re-serialized body → 401. Catches any parse-before-verify (mirrors
	// stripe-webhook.test.ts:150-167).
	test('returns 401 when the signed body is reparsed before delivery', async () => {
		const app = makeSlackApp(realSlackLayer)
		const payloadJson = JSON.stringify({
			type: 'block_actions',
			team: { id: 'T123' },
			actions: [{ action_id: 'view_task', value: 'task-1' }],
		})
		// Sign a body with a trailing separator; deliver the same fields without it. Both
		// decode to an identical `payload`, but the raw bytes — and thus the HMAC — differ.
		const signedBody = `${new URLSearchParams({ payload: payloadJson }).toString()}&`
		const deliveredBody = new URLSearchParams({ payload: payloadJson }).toString()
		expect(signedBody).not.toBe(deliveredBody)

		const response = await app.request('/webhooks/slack/interactions', {
			method: 'POST',
			headers: signedHeaders({ rawBody: signedBody }),
			body: deliveredBody,
		})

		expect(response.status).toBe(401)
		expect(await response.json()).toEqual({ error: 'invalid_request' })
	})

	// (D) ACK survives a processing defect: verification succeeds but the forked handler
	// dies → the route still returns 200 (proves the fork isolates the ACK; validates the
	// Option-C decision, mirrors the artifacts-upsert-slack.test.ts defect test).
	test('returns 200 even when the forked handler defects', async () => {
		const fakePayload: SlackInteractionPayload = { type: 'block_actions' }
		const defectSlackLayer = Layer.succeed(SlackService, {
			createInstallUrl: () => Effect.die('createInstallUrl not used'),
			exchangeCode: () => Effect.die('exchangeCode not used'),
			getStatus: () => Effect.die('getStatus not used'),
			disconnect: () => Effect.die('disconnect not used'),
			listChannels: () => Effect.die('listChannels not used'),
			dispatchArtifactEvent: () => Effect.void,
			dispatchCommentEvent: () => Effect.void,
			verifyInteractionRequest: () => Effect.succeed(fakePayload),
			handleInteractionPayload: () => Effect.die('boom'),
		})
		const app = makeSlackApp(defectSlackLayer)

		// The verify stub ignores the signature, so any body/headers reach the fork.
		const response = await app.request('/webhooks/slack/interactions', {
			method: 'POST',
			headers: signedHeaders({ rawBody: blockActionsBody() }),
			body: blockActionsBody(),
		})

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({ ok: true })
	})
})
