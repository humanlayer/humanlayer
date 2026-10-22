import type { slackNotificationAutomations } from '@humanlayer/db/tables/slack-notification-automations'
import type { tasks } from '@humanlayer/db/tables/tasks'
import type { Duration, Effect, Redacted } from 'effect'
import * as Schema from 'effect/Schema'
import * as SchemaTransformation from 'effect/SchemaTransformation'

import type { PostgresDb } from '../postgres/postgres-db.service'
import type { WorkosService } from '../workos/workos.service'
import type {
	SlackApiUnavailableError,
	SlackChannelNotFoundError,
	SlackInstallStateInvalidError,
	SlackIntegrationUnavailableError,
	SlackMissingScopeError,
	SlackNeedsReauthError,
	SlackNotConnectedError,
	SlackNotInChannelError,
	SlackOAuthError,
	SlackRateLimitError,
	SlackTokenRevokedError,
	SlackUnexpectedResponseError,
	SlackWebhookMalformedRequestError,
	SlackWebhookRequestTooOldError,
	SlackWebhookSignatureInvalidError,
} from './slack.errors'
import type { SlackOAuthAccessResponse } from './slack.schema'

export type SlackChannel = { id: string; name: string; isPrivate: boolean }

export type SlackClientConfig = {
	clientId: string
	clientSecret: Redacted.Redacted<string>
	oauthRedirectUrl: string
}

export type SlackPostMessageInput = {
	botToken: Redacted.Redacted<string>
	channelId: string
	blocks: SlackBlock[]
	threadTs?: string
	broadcast?: boolean
}

export type SlackPostMessageResult = { ts: string }

export type SlackPostMessage = (
	input: SlackPostMessageInput,
) => Effect.Effect<SlackPostMessageResult, SlackProviderError>

export type SlackExchangeOAuthCodeInput = { code: string }

export type SlackSdkClient = {
	postMessage: SlackPostMessage
	exchangeOAuthCode: (
		input: SlackExchangeOAuthCodeInput,
	) => Effect.Effect<SlackOAuthAccessResponse, SlackProviderError>
	paginateChannels: (
		botToken: Redacted.Redacted<string>,
	) => Effect.Effect<readonly SlackChannel[], SlackProviderError>
}

export type SlackClassifyContext = { channelId?: string; oauth?: boolean }

export type SlackRateLimitTransportCause = { retryAfter?: Duration.Input }

export type SlackUnknownTransportCause = { code?: string }

export type SlackAutomationEventType =
	| 'design-discussion'
	| 'design-prd'
	| 'design-tdd'
	| 'structure-outline'
	| 'comment'

export type SlackArtifactAutomationEventType = Exclude<SlackAutomationEventType, 'comment'>

/**
 * Slack does a stupid thing where all responses 200 and then it indicates if it's okay or returns an error.
 */
export const SlackApiResponseBodySchema = Schema.Struct({
	ok: Schema.optional(Schema.Boolean),
	error: Schema.optional(Schema.String),
	needed: Schema.optional(Schema.String),
	provided: Schema.optional(Schema.String),
})

export type SlackApiResponseBody = {
	ok?: unknown
	error?: string
	needed?: string
	provided?: string
}

export const SlackChannelResponseChannel = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
	is_private: Schema.Boolean,
})
export interface SlackChannelResponseChannel extends Schema.Schema.Type<typeof SlackChannelResponseChannel> {}

export const SlackChannelResponse = Schema.Struct({
	channels: Schema.Array(SlackChannelResponseChannel),
	cursor: Schema.UndefinedOr(Schema.String),
})
export interface SlackChannelResponse extends Schema.Schema.Type<typeof SlackChannelResponse> {}

const SlackChannelResponsePayloadWire = Schema.Struct({
	channels: Schema.Array(SlackChannelResponseChannel),
	response_metadata: Schema.optional(
		Schema.Struct({
			next_cursor: Schema.String,
		}),
	),
})

export const SlackChannelResponsePayload = SlackChannelResponsePayloadWire.pipe(
	Schema.decodeTo(
		SlackChannelResponse,
		SchemaTransformation.transform({
			decode: (payload) => ({
				channels: payload.channels,
				cursor: payload.response_metadata?.next_cursor,
			}),
			encode: (response) => ({
				channels: response.channels,
				response_metadata: response.cursor === undefined ? undefined : { next_cursor: response.cursor },
			}),
		}),
	),
)

export type { SlackOAuthAccessResponse } from './slack.schema'

export type SlackConnectionStatus = {
	connected: boolean
	enabled: boolean
	needsReauth: boolean
	teamName?: string
	lastErrorCode?: string
}

export type SlackArtifactEvent = {
	organizationId: string
	taskId: string
	taskSlug: string | null
	artifactId: string
	fileName: string
	artifactType: string | undefined
	resourceOwnerUserId: string
	actorUserId: string
	created: boolean
	versionNumber?: number
}

export type SlackBlock = Record<string, unknown>

export type SlackCommentEvent = {
	organizationId: string
	taskId: string
	taskSlug?: string | null
	artifactId: string
	fileName: string
	commentId: string
	resourceOwnerUserId: string
	commenterUserId: string
	contentText: string
	quotedText?: string
}

export type SlackEvent = SlackArtifactEvent | SlackCommentEvent

export type AutomationMessage = {
	rootBlocks: SlackBlock[]
	replyBlocks: SlackBlock[]
	broadcast: boolean
}

export type MatchingAutomationRow = {
	automation: typeof slackNotificationAutomations.$inferSelect
	task: typeof tasks.$inferSelect | null
}

export type AutomationMessageBuilder = (
	row: MatchingAutomationRow,
	actorDisplayName: string | null,
) => AutomationMessage | null

export type DeliveryContext = {
	organizationId: string
	taskId: string
	automationId: string
	channelId: string
}

export type DispatchArtifactEventInput = {
	event: SlackArtifactEvent
	appOrigin: string
	postMessage: SlackPostMessage
}

export type DispatchCommentEventInput = {
	event: SlackCommentEvent
	appOrigin: string
	postMessage: SlackPostMessage
}

export type DeliverToAutomationInput = {
	event: SlackEvent
	row: MatchingAutomationRow
	botToken: Redacted.Redacted<string>
	actorDisplayName: string | null
	postMessage: SlackPostMessage
	buildMessage: AutomationMessageBuilder
}

export type EnsureSlackThreadRootInput = {
	postMessage: SlackPostMessage
	botToken: Redacted.Redacted<string>
	organizationId: string
	automationId: string
	channelId: string
	taskId: string
	rootBlocks: SlackBlock[]
}

export type EnsureSlackThreadRootResult = { rootTs: string; created: boolean }

export type SlackThreadClaimReleaseContext = DeliveryContext & { threadId: string }

export type CreateSlackInstallStateInput = {
	organizationId: string
	requestedByUserId: string
}

export type CreateSlackInstallStateResult = { state: string; expiresAt: number }

export type ConsumeSlackInstallStateResult = { organizationId: string; requestedByUserId: string }

export type MarkSlackThreadDeliveryFailedInput = {
	automationId: string
	channelId: string
	taskId: string
	errorCode: string
}

export type BuildSlackInstallUrlInput = {
	slackApiBaseUrl: string
	clientId: string
	scopes: string
	oauthRedirectUrl: string
	state: string
}

export type SlackConnectionFromOAuthResponseInput = {
	response: SlackOAuthAccessResponse
	organizationId: string
	connectedByUserId: string
	scopes: string
	appId: string | null
}

export type SlackConnectionFromOAuthResponseResult = {
	connection: RecordSlackConnectionInput
	teamName: string | null
}

export type SlackServiceCreateInstallUrlInput = CreateSlackInstallStateInput

export type SlackServiceCreateInstallUrlResult = { url: string; expiresAt: number }

export type SlackServiceExchangeCodeInput = { code: string; state: string }

export type SlackServiceExchangeCodeResult = { teamName?: string }

export type SlackOrganizationInput = { organizationId: string }

/**
 * A single action inside a Slack `block_actions` interaction payload. `action_id`
 * and `value` are optional because Slack ships several action variants (buttons vs
 * selects vs overflows), but the outer struct always contains an `actions` array
 * for `block_actions` payloads.
 */
export const SlackInteractionAction = Schema.Struct({
	action_id: Schema.optional(Schema.String),
	value: Schema.optional(Schema.String),
})
export type SlackInteractionAction = Schema.Schema.Type<typeof SlackInteractionAction>

/**
 * A parsed Slack interactivity request payload (the JSON inside the `payload` form
 * field). `type` is the only field Slack guarantees on every interaction shape (see
 * https://docs.slack.dev/interactivity/handling-user-interaction); the remaining
 * fields are populated per-shape (`block_actions` fills `actions`/`channel`/`message`,
 * `view_submission` fills `view`, etc.). The decoder therefore requires `type` and
 * treats the rest as optional so we can accept every interaction shape and log the
 * safe projection uniformly (`interactionLogFields`). The payload is never returned
 * across an oRPC boundary.
 */
export const SlackInteractionPayload = Schema.Struct({
	type: Schema.String,
	team: Schema.optional(Schema.Struct({ id: Schema.String })),
	user: Schema.optional(Schema.Struct({ id: Schema.String })),
	channel: Schema.optional(Schema.Struct({ id: Schema.String })),
	message: Schema.optional(Schema.Struct({ ts: Schema.String })),
	actions: Schema.optional(Schema.Array(SlackInteractionAction)),
	response_url: Schema.optional(Schema.String),
})
export type SlackInteractionPayload = Schema.Schema.Type<typeof SlackInteractionPayload>

/**
 * The raw facts the Hono route legitimately holds and hands to the Slack service:
 * the exact request body (captured before any parse) and the request headers. The
 * signing secret, timestamp, and signature are Slack-module internals and are not
 * part of this input.
 */
export type SlackInteractionRequestInput = {
	rawBody: string
	headers: Headers
}

export type SlackServiceShape = {
	createInstallUrl: (
		input: SlackServiceCreateInstallUrlInput,
	) => Effect.Effect<SlackServiceCreateInstallUrlResult, SlackIntegrationUnavailableError, PostgresDb>
	exchangeCode: (
		input: SlackServiceExchangeCodeInput,
	) => Effect.Effect<
		SlackServiceExchangeCodeResult,
		SlackInstallStateInvalidError | SlackOAuthError | SlackIntegrationUnavailableError,
		PostgresDb
	>
	getStatus: (
		input: SlackOrganizationInput,
	) => Effect.Effect<SlackConnectionStatus, SlackIntegrationUnavailableError, PostgresDb>
	disconnect: (input: SlackOrganizationInput) => Effect.Effect<void, SlackIntegrationUnavailableError, PostgresDb>
	listChannels: (
		input: SlackOrganizationInput,
	) => Effect.Effect<
		readonly SlackChannel[],
		SlackNotConnectedError | SlackNeedsReauthError | SlackIntegrationUnavailableError,
		PostgresDb
	>
	dispatchArtifactEvent: (event: SlackArtifactEvent) => Effect.Effect<void, never, PostgresDb | WorkosService>
	dispatchCommentEvent: (event: SlackCommentEvent) => Effect.Effect<void, never, PostgresDb | WorkosService>
	/**
	 * Verifies a Slack interactivity request end to end: timestamp freshness (5-minute
	 * window), HMAC-SHA256 signature over the raw body, and `payload` JSON parsing. The
	 * signing secret and crypto are encapsulated here, so the route only supplies the raw
	 * body + headers and branches on the typed result. Does not log — its typed failure
	 * propagates to the route, which warn-logs the rejection.
	 */
	verifyInteractionRequest: (
		input: SlackInteractionRequestInput,
	) => Effect.Effect<
		SlackInteractionPayload,
		SlackWebhookSignatureInvalidError | SlackWebhookRequestTooOldError | SlackWebhookMalformedRequestError
	>
	/**
	 * Best-effort processing of a verified interaction: emits one safe structured log
	 * line and captures unexpected defects to Sentry. Structurally cannot fail (`never`)
	 * so the route can fork it without ever risking the ACK.
	 */
	handleInteractionPayload: (payload: SlackInteractionPayload) => Effect.Effect<void, never>
}

export type RecordSlackConnectionInput = {
	organizationId: string
	connectedByUserId: string
	botAccessToken: string
	botUserId: string
	scopes: string
	teamId: string | null
	teamName: string | null
	appId: string | null
}

export type SlackProviderError =
	| SlackOAuthError
	| SlackTokenRevokedError
	| SlackMissingScopeError
	| SlackNotInChannelError
	| SlackChannelNotFoundError
	| SlackRateLimitError
	| SlackApiUnavailableError
	| SlackUnexpectedResponseError

export type SlackConnectionError =
	| SlackNotConnectedError
	| SlackInstallStateInvalidError
	| SlackNeedsReauthError
	| SlackIntegrationUnavailableError

export type SlackError = SlackProviderError | SlackConnectionError

export type FormatArtifactSlackMessageInput = {
	event: SlackArtifactEvent
	appOrigin: string
	taskName?: string | null
	ownerName?: string | null
}

export type FormatCommentSlackMessageInput = {
	event: SlackCommentEvent
	appOrigin: string
	taskName?: string | null
	commenterName?: string | null
}
