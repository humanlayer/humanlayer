import * as Schema from 'effect/Schema'

export const SlackApiEnvelopeSchema = Schema.Struct({
	ok: Schema.Boolean,
	error: Schema.optional(Schema.String),
	needed: Schema.optional(Schema.String),
	provided: Schema.optional(Schema.String),
})
export type SlackApiEnvelope = Schema.Schema.Type<typeof SlackApiEnvelopeSchema>

export const SlackOAuthAccessResponseSchema = Schema.Struct({
	ok: Schema.Boolean,
	error: Schema.optional(Schema.String),
	warning: Schema.optional(Schema.String),
	needed: Schema.optional(Schema.String),
	provided: Schema.optional(Schema.String),
	app_id: Schema.optional(Schema.String),
	scope: Schema.optional(Schema.String),
	access_token: Schema.optional(Schema.RedactedFromValue(Schema.String)),
	bot_user_id: Schema.optional(Schema.String),
	team: Schema.optional(Schema.Struct({ id: Schema.optional(Schema.String), name: Schema.optional(Schema.String) })),
	enterprise: Schema.optional(
		Schema.NullOr(Schema.Struct({ id: Schema.optional(Schema.String), name: Schema.optional(Schema.String) })),
	),
	is_enterprise_install: Schema.optional(Schema.Boolean),
})
export type SlackOAuthAccessResponse = Schema.Schema.Type<typeof SlackOAuthAccessResponseSchema>

export const SlackConversationsListResponseSchema = Schema.Struct({
	ok: Schema.Boolean,
	error: Schema.optional(Schema.String),
	needed: Schema.optional(Schema.String),
	provided: Schema.optional(Schema.String),
	channels: Schema.optional(
		Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String, is_private: Schema.Boolean })),
	),
	response_metadata: Schema.optional(Schema.Struct({ next_cursor: Schema.optional(Schema.String) })),
})
export type SlackConversationsListResponse = Schema.Schema.Type<typeof SlackConversationsListResponseSchema>

export const SlackPostMessageResponseSchema = Schema.Struct({
	ok: Schema.Boolean,
	error: Schema.optional(Schema.String),
	needed: Schema.optional(Schema.String),
	provided: Schema.optional(Schema.String),
	ts: Schema.optional(Schema.String),
})
export type SlackPostMessageResponse = Schema.Schema.Type<typeof SlackPostMessageResponseSchema>

export const SlackPostMessageRequestSchema = Schema.Struct({
	channel: Schema.String,
	blocks: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)),
	unfurl_links: Schema.Boolean,
	unfurl_media: Schema.Boolean,
	thread_ts: Schema.optional(Schema.String),
	reply_broadcast: Schema.optional(Schema.Boolean),
})
