import * as Schema from 'effect/Schema'

type Writable<T> = { -readonly [Key in keyof T]: T[Key] }

export const ResendErrorEnvelopeSchema = Schema.Struct({
	statusCode: Schema.Union([Schema.Number, Schema.Null]),
	message: Schema.String,
	name: Schema.String,
})
export interface ResendErrorEnvelope extends Schema.Schema.Type<typeof ResendErrorEnvelopeSchema> {}

export const ResendEmailRequestSchema = Schema.Struct({
	from: Schema.NonEmptyString,
	to: Schema.NonEmptyString,
	subject: Schema.String,
	text: Schema.String,
	html: Schema.optionalKey(Schema.String),
	scheduledAt: Schema.optionalKey(Schema.String),
}).pipe(Schema.encodeKeys({ scheduledAt: 'scheduled_at' }))
export interface ResendEmailRequest extends Schema.Schema.Type<typeof ResendEmailRequestSchema> {}
export type ResendEmailRequestBody = Writable<ResendEmailRequest>

export const ResendIdempotencyKeySchema = Schema.String.check(Schema.isBetweenLength(1, 256))

export const ResendEmailResponseSchema = Schema.Struct({ id: Schema.NonEmptyString })
export interface ResendEmailResponse extends Schema.Schema.Type<typeof ResendEmailResponseSchema> {}

export const ResendCanceledEmailResponseSchema = Schema.Struct({
	object: Schema.Literal('email'),
	id: Schema.NonEmptyString,
})
export interface ResendCanceledEmailResponse extends Schema.Schema.Type<typeof ResendCanceledEmailResponseSchema> {}

export const ResendContactPropertySchema = Schema.Union([
	Schema.Struct({ type: Schema.Literal('string'), value: Schema.String }),
	Schema.Struct({ type: Schema.Literal('number'), value: Schema.Number }),
])
export type ResendContactProperty = Schema.Schema.Type<typeof ResendContactPropertySchema>

export const ResendContactResponseSchema = Schema.Struct({
	object: Schema.Literal('contact'),
	id: Schema.NonEmptyString,
	email: Schema.NonEmptyString,
	first_name: Schema.optionalKey(Schema.NullOr(Schema.String)),
	last_name: Schema.optionalKey(Schema.NullOr(Schema.String)),
	created_at: Schema.String,
	unsubscribed: Schema.Boolean,
	properties: Schema.Record(Schema.String, ResendContactPropertySchema),
})
export interface ResendContactResponse extends Schema.Schema.Type<typeof ResendContactResponseSchema> {}

export const ResendContactResultSchema = Schema.Struct({
	object: Schema.Literal('contact'),
	id: Schema.NonEmptyString,
})
export interface ResendContactResult extends Schema.Schema.Type<typeof ResendContactResultSchema> {}

export const ResendContactCreateRequestSchema = Schema.Struct({
	email: Schema.NonEmptyString,
	firstName: Schema.optionalKey(Schema.NullOr(Schema.String)),
	lastName: Schema.optionalKey(Schema.NullOr(Schema.String)),
	unsubscribed: Schema.optionalKey(Schema.Boolean),
	properties: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
	segments: Schema.optionalKey(Schema.Array(Schema.Struct({ id: Schema.NonEmptyString }))),
}).pipe(Schema.encodeKeys({ firstName: 'first_name', lastName: 'last_name' }))
export interface ResendContactCreateRequest extends Schema.Schema.Type<typeof ResendContactCreateRequestSchema> {}
export type ResendContactCreateRequestBody = Writable<ResendContactCreateRequest>

export const ResendContactUpdateRequestSchema = Schema.Struct({
	firstName: Schema.optionalKey(Schema.NullOr(Schema.String)),
	lastName: Schema.optionalKey(Schema.NullOr(Schema.String)),
	unsubscribed: Schema.optionalKey(Schema.Boolean),
	properties: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
}).pipe(Schema.encodeKeys({ firstName: 'first_name', lastName: 'last_name' }))
export interface ResendContactUpdateRequest extends Schema.Schema.Type<typeof ResendContactUpdateRequestSchema> {}
export type ResendContactUpdateRequestBody = Writable<ResendContactUpdateRequest>

export const ResendEventRequestSchema = Schema.Struct({
	event: Schema.NonEmptyString,
	email: Schema.NonEmptyString,
	payload: Schema.optionalKey(Schema.Record(Schema.String, Schema.Json)),
})
export interface ResendEventRequest extends Schema.Schema.Type<typeof ResendEventRequestSchema> {}
export type ResendEventRequestBody = Writable<ResendEventRequest>

export const ResendEventResponseSchema = Schema.Struct({
	object: Schema.Literal('event'),
	event: Schema.NonEmptyString,
})
export interface ResendEventResponse extends Schema.Schema.Type<typeof ResendEventResponseSchema> {}
