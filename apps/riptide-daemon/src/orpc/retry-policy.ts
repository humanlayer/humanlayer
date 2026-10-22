import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'

const TRANSIENT_HTTP_STATUSES = new Set([408, 425, 429])

const HttpFailureEnvelope = Schema.Struct({
	status: Schema.optionalKey(Schema.Number),
	response: Schema.optionalKey(Schema.Unknown),
	cause: Schema.optionalKey(Schema.Unknown),
})

function statusFromUnknown(value: unknown): number | undefined {
	const envelope = Option.getOrUndefined(Schema.decodeUnknownOption(HttpFailureEnvelope)(value))
	if (envelope === undefined) return undefined
	if (envelope.status !== undefined) return envelope.status

	if (envelope.response !== undefined) {
		const responseStatus = statusFromUnknown(envelope.response)
		if (responseStatus !== undefined) return responseStatus
	}

	if (envelope.cause !== undefined) return statusFromUnknown(envelope.cause)

	return undefined
}

export function getHttpStatus(error: unknown): number | undefined {
	return statusFromUnknown(error)
}

export function shouldRetryORPCRequest(error: unknown): boolean {
	const status = getHttpStatus(error)
	if (status === undefined) return true
	return TRANSIENT_HTTP_STATUSES.has(status) || status >= 500
}
