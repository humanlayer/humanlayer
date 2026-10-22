import { Clock, Context, Effect, Layer, Redacted } from 'effect'
import * as Config from 'effect/Config'
import * as FetchHttpClient from 'effect/http/FetchHttpClient'

import { Sentry } from '../../../instrument'
import { SlackHttpClientLive } from './slack-http-client.layer'
import { SlackProviderClient, SlackProviderClientLive } from './slack.client'
import { dispatchArtifactEvent, dispatchCommentEvent } from './slack.dispatch'
import {
	SlackIntegrationUnavailableError,
	SlackNeedsReauthError,
	SlackOAuthError,
	SlackWebhookRequestTooOldError,
	SlackWebhookSignatureInvalidError,
} from './slack.errors'
import {
	computeSlackSignature,
	interactionLogFields,
	parseInteractionPayload,
	safeSignatureEqual,
	SLACK_REQUEST_MAX_AGE_SECONDS,
} from './slack.interactions'
import { buildInstallUrl, slackConnectionFromOAuthResponse, slackOAuthRedirectUrlFromApiOrigin } from './slack.oauth'
import {
	consumeSlackInstallState,
	createSlackInstallState,
	disconnectSlackIntegration,
	getSlackConnectionStatus,
	markSlackConnectionNeedsReauth,
	recordSlackConnection,
	requireSlackConnection,
	setSlackIntegrationEnabled,
} from './slack.persistence'
import type { SlackServiceShape } from './slack.types'

export class SlackService extends Context.Service<SlackService, SlackServiceShape>()('SlackService') {}

const SlackServiceImplementationLive = Layer.effect(
	SlackService,
	Effect.gen(function* () {
		const clientId = yield* Config.String('SLACK_CLIENT_ID')
		const appId = yield* Config.String('SLACK_APP_ID')
		const signingSecret = yield* Config.Redacted('SLACK_SIGNING_SECRET')
		const apiBaseUrl = yield* Config.String('SLACK_API_BASE_URL').pipe(Config.withDefault('https://slack.com'))
		const apiOrigin = yield* Config.URL('RIPTIDE_API_ORIGIN').pipe(
			Config.withDefault(new URL('http://localhost:8700')),
		)
		const oauthRedirectUrl = yield* Config.URL('SLACK_OAUTH_REDIRECT_URL').pipe(
			Config.withDefault(slackOAuthRedirectUrlFromApiOrigin(apiOrigin)),
			Config.map((url) => url.toString()),
		)
		const appOrigin = yield* Config.String('APP_ORIGIN')
		const scopes = yield* Config.String('SLACK_BOT_SCOPES').pipe(
			Config.withDefault('chat:write,chat:write.public,channels:read,groups:read'),
		)
		const slack = yield* SlackProviderClient
		return {
			createInstallUrl: Effect.fn('slack.create_install_url')(function* ({ organizationId, requestedByUserId }) {
				yield* Effect.annotateCurrentSpan({ organization_id: organizationId })
				const { state, expiresAt } = yield* createSlackInstallState({ organizationId, requestedByUserId })
				return {
					url: buildInstallUrl({
						slackApiBaseUrl: apiBaseUrl,
						clientId,
						scopes,
						oauthRedirectUrl,
						state,
					}),
					expiresAt,
				}
			}),
			exchangeCode: Effect.fn('slack.exchange_code')(function* ({ code, state }) {
				const claim = yield* consumeSlackInstallState(state)
				yield* Effect.annotateCurrentSpan({ organization_id: claim.organizationId })
				const response = yield* slack
					.exchangeOAuthCode({ code })
					.pipe(
						Effect.mapError(
							(error): SlackOAuthError =>
								new SlackOAuthError({ code: 'slack_oauth_failed', cause: error }),
						),
					)
				const install = yield* slackConnectionFromOAuthResponse({
					response,
					organizationId: claim.organizationId,
					connectedByUserId: claim.requestedByUserId,
					scopes,
					appId: appId || null,
				})
				yield* recordSlackConnection(install.connection)
				yield* setSlackIntegrationEnabled(claim.organizationId, true)
				const result = install.teamName ? { teamName: install.teamName } : {}
				yield* Effect.annotateCurrentSpan({ has_team_name: Boolean(result.teamName) })
				return result
			}),
			getStatus: Effect.fn('slack.get_status')(function* ({ organizationId }) {
				yield* Effect.annotateCurrentSpan({ organization_id: organizationId })
				const status = yield* getSlackConnectionStatus(organizationId)
				yield* Effect.annotateCurrentSpan({
					connected: status.connected,
					enabled: status.enabled,
					needs_reauth: status.needsReauth,
				})
				return status
			}),
			disconnect: Effect.fn('slack.disconnect')(function* ({ organizationId }) {
				yield* Effect.annotateCurrentSpan({ organization_id: organizationId })
				return yield* disconnectSlackIntegration(organizationId)
			}),
			listChannels: Effect.fn('slack.list_channels')(function* ({ organizationId }) {
				yield* Effect.annotateCurrentSpan({ organization_id: organizationId })
				const connection = yield* requireSlackConnection(organizationId)
				const channels = yield* slack.paginateChannels(Redacted.make(connection.bot_access_token)).pipe(
					Effect.catchTag(['SlackTokenRevokedError', 'SlackMissingScopeError'], (error) =>
						markSlackConnectionNeedsReauth(organizationId, error._tag).pipe(
							Effect.catchTag('SlackIntegrationUnavailableError', () => Effect.void),
							Effect.flatMap(() =>
								Effect.fail(new SlackNeedsReauthError({ organizationId, lastErrorCode: error._tag })),
							),
						),
					),
					Effect.catchTags({
						SlackNotInChannelError: (cause) => Effect.fail(new SlackIntegrationUnavailableError({ cause })),
						SlackChannelNotFoundError: (cause) =>
							Effect.fail(new SlackIntegrationUnavailableError({ cause })),
						SlackRateLimitError: (cause) => Effect.fail(new SlackIntegrationUnavailableError({ cause })),
						SlackApiUnavailableError: (cause) =>
							Effect.fail(new SlackIntegrationUnavailableError({ cause })),
						SlackUnexpectedResponseError: (cause) =>
							Effect.fail(new SlackIntegrationUnavailableError({ cause })),
						SlackOAuthError: (cause) => Effect.fail(new SlackIntegrationUnavailableError({ cause })),
					}),
				)
				yield* Effect.annotateCurrentSpan({ channel_count: channels.length })
				return channels
			}),
			dispatchArtifactEvent: Effect.fn('slack.dispatch_artifact_event')(function* (event) {
				yield* Effect.annotateCurrentSpan({
					organization_id: event.organizationId,
					task_id: event.taskId,
					artifact_id: event.artifactId,
				})
				return yield* dispatchArtifactEvent({ event, appOrigin, postMessage: slack.postMessage })
			}),
			dispatchCommentEvent: Effect.fn('slack.dispatch_comment_event')(function* (event) {
				yield* Effect.annotateCurrentSpan({
					organization_id: event.organizationId,
					task_id: event.taskId,
					comment_id: event.commentId,
				})
				return yield* dispatchCommentEvent({ event, appOrigin, postMessage: slack.postMessage })
			}),
			verifyInteractionRequest: Effect.fn('slack.verify_interaction_request')(function* ({ rawBody, headers }) {
				const providedSignature = headers.get('X-Slack-Signature')
				const timestampHeader = headers.get('X-Slack-Request-Timestamp')
				if (!providedSignature) {
					return yield* Effect.fail(
						new SlackWebhookSignatureInvalidError({ reason: 'missing_signature_header' }),
					)
				}
				if (!timestampHeader) {
					return yield* Effect.fail(
						new SlackWebhookSignatureInvalidError({ reason: 'missing_timestamp_header' }),
					)
				}
				const timestampSeconds = Number(timestampHeader)
				if (!Number.isFinite(timestampSeconds)) {
					return yield* Effect.fail(
						new SlackWebhookSignatureInvalidError({ reason: 'invalid_timestamp_header' }),
					)
				}

				// Replay guard: reject requests whose timestamp is more than 5 minutes from
				// now, before the signature is trusted. `Clock` makes `now` injectable so the
				// window is deterministic under TestClock.
				const nowMillis = yield* Clock.currentTimeMillis
				const ageSeconds = Math.abs(nowMillis / 1000 - timestampSeconds)
				if (ageSeconds > SLACK_REQUEST_MAX_AGE_SECONDS) {
					return yield* Effect.fail(new SlackWebhookRequestTooOldError({ ageSeconds }))
				}

				const expectedSignature = computeSlackSignature({
					signingSecret: Redacted.value(signingSecret),
					timestamp: timestampHeader,
					rawBody,
				})
				if (!safeSignatureEqual(expectedSignature, providedSignature)) {
					return yield* Effect.fail(new SlackWebhookSignatureInvalidError({ reason: 'signature_mismatch' }))
				}

				const payload = yield* parseInteractionPayload(rawBody)
				yield* Effect.annotateCurrentSpan({ interaction_type: payload.type })
				return payload
			}),
			handleInteractionPayload: Effect.fn('slack.handle_interaction_payload')(function* (payload) {
				return yield* Effect.logInfo('Slack interaction received').pipe(
					Effect.annotateLogs(interactionLogFields(payload)),
					Effect.catchCause((cause) =>
						Effect.sync(() =>
							Sentry.captureException(cause, {
								tags: { error_type: 'slack_interaction_processing' },
							}),
						),
					),
				)
			}),
		}
	}),
)

const SlackProviderClientConfiguredLive = SlackProviderClientLive.pipe(Layer.provide(SlackHttpClientLive))

export const SlackServiceLiveBase = SlackServiceImplementationLive.pipe(
	Layer.provideMerge(SlackProviderClientConfiguredLive),
)

export const SlackServiceLive = SlackServiceLiveBase.pipe(Layer.provide(FetchHttpClient.layer))
