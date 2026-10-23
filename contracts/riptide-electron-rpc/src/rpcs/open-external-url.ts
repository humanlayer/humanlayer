import * as Rpc from 'effect/rpc/Rpc'
import * as Schema from 'effect/Schema'

export const OpenExternalUrlPayload = Schema.Struct({ url: Schema.String })
export type OpenExternalUrlPayload = typeof OpenExternalUrlPayload.Type

export class ExternalUrlNotAllowedError extends Schema.TaggedError<ExternalUrlNotAllowedError>()(
	'ExternalUrlNotAllowedError',
	{ message: Schema.String },
) {}

export class ExternalUrlOpenError extends Schema.TaggedError<ExternalUrlOpenError>()('ExternalUrlOpenError', {
	message: Schema.String,
}) {}

export const OpenExternalUrlError = Schema.Union([ExternalUrlNotAllowedError, ExternalUrlOpenError])
export type OpenExternalUrlError = typeof OpenExternalUrlError.Type

export class OpenExternalUrl extends Rpc.make('OpenExternalUrl', {
	payload: OpenExternalUrlPayload,
	success: Schema.Void,
	error: OpenExternalUrlError,
}) {}
