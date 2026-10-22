import { createHmac, timingSafeEqual } from 'node:crypto'

import { Effect } from 'effect'
import * as Schema from 'effect/Schema'

import { SlackWebhookMalformedRequestError } from './slack.errors'
import { SlackInteractionPayload } from './slack.types'

/**
 * Pure functional core for Slack interactivity request verification.
 *
 * Sync helpers with no failure mode stay as plain functions (mirroring
 * `slack.oauth.ts`'s `buildInstallUrl`); anything that can fail returns an Effect
 * with a typed error (mirroring `slackConnectionFromOAuthResponse`). Nothing here
 * throws — the shell (`slack.service.ts`) never has to reason about caught
 * exceptions crossing the seam.
 *
 * Slack-protocol constants (signature version, replay window) live here so the
 * shell doesn't have to redefine them and so tests can reference them directly
 * without importing from `slack.service.ts`.
 *
 * @see https://docs.slack.dev/authentication/verifying-requests-from-slack/
 */

const SLACK_SIGNATURE_VERSION = 'v0'

/** Slack's recommended interactivity replay window: reject requests older than 5 minutes. */
export const SLACK_REQUEST_MAX_AGE_SECONDS = 300

/**
 * Computes the `X-Slack-Signature` value for a request.
 *
 * Follows Slack's recipe exactly: build the base string `v0:{timestamp}:{rawBody}`,
 * HMAC-SHA256 it with the signing secret, and return the lowercase hex digest
 * prefixed with `v0=`.
 */
export function computeSlackSignature(input: { signingSecret: string; timestamp: string; rawBody: string }): string {
	const baseString = `${SLACK_SIGNATURE_VERSION}:${input.timestamp}:${input.rawBody}`
	const digest = createHmac('sha256', input.signingSecret).update(baseString).digest('hex')
	return `${SLACK_SIGNATURE_VERSION}=${digest}`
}

/**
 * Constant-time comparison of two `v0=…` signature strings.
 *
 * `crypto.timingSafeEqual` throws when the two buffers differ in length, so a
 * length guard short-circuits (mismatched lengths can never be equal anyway),
 * keeping the comparison total and side-channel resistant.
 */
export function safeSignatureEqual(expected: string, provided: string): boolean {
	const expectedBuffer = Buffer.from(expected, 'utf8')
	const providedBuffer = Buffer.from(provided, 'utf8')
	if (expectedBuffer.length !== providedBuffer.length) return false
	return timingSafeEqual(expectedBuffer, providedBuffer)
}

const decodeSlackInteractionPayload = Schema.decodeUnknownEffect(SlackInteractionPayload)

/**
 * Extracts and decodes the `payload` form field from an interactive component
 * request body (`application/x-www-form-urlencoded`).
 *
 * Runs only after the signature has been verified, so the input is trusted-authentic
 * bytes. Failures — missing field, invalid JSON, or a struct that doesn't match — are
 * emitted through the typed error channel; nothing here throws.
 */
export function parseInteractionPayload(
	rawBody: string,
): Effect.Effect<SlackInteractionPayload, SlackWebhookMalformedRequestError> {
	const payloadField = new URLSearchParams(rawBody).get('payload')
	if (payloadField === null) {
		return Effect.fail(new SlackWebhookMalformedRequestError({ reason: 'missing_payload_field' }))
	}
	return Effect.try({
		try: () => JSON.parse(payloadField) as unknown,
		catch: (cause) =>
			new SlackWebhookMalformedRequestError({
				reason: cause instanceof Error ? `invalid_payload_json: ${cause.message}` : 'invalid_payload_json',
			}),
	}).pipe(
		Effect.flatMap((parsed) =>
			decodeSlackInteractionPayload(parsed).pipe(
				Effect.mapError(
					(cause) =>
						new SlackWebhookMalformedRequestError({
							reason: `payload_schema_mismatch: ${cause.message}`,
						}),
				),
			),
		),
	)
}

/** Reads the defined `action_id`s across the payload's actions, if any. */
function actionIds(payload: SlackInteractionPayload): string[] {
	if (!payload.actions) return []
	return payload.actions
		.map((action) => action.action_id)
		.filter((actionId): actionId is string => typeof actionId === 'string')
}

/** Reads the defined `value` fields across the payload's actions, if any. */
function actionValues(payload: SlackInteractionPayload): string[] {
	if (!payload.actions) return []
	return payload.actions.map((action) => action.value).filter((value): value is string => typeof value === 'string')
}

/**
 * Projects a verified interaction payload down to the safe, structured fields the
 * module logs — no secrets and no full raw payload. Missing fields are omitted
 * rather than logged as `undefined`.
 */
export function interactionLogFields(payload: SlackInteractionPayload) {
	return {
		type: payload.type,
		team_id: payload.team?.id,
		user_id: payload.user?.id,
		channel_id: payload.channel?.id,
		message_ts: payload.message?.ts,
		action_ids: actionIds(payload),
		action_values: actionValues(payload),
		has_response_url: Boolean(payload.response_url),
	}
}
