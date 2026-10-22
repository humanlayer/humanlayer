import { Effect, Stream } from 'effect'
import type { HttpClientResponse } from 'effect/http'
import type { HttpClientError } from 'effect/http/HttpClientError'

import { copyProxyHeaders, isNullBodyStatus } from './proxy-headers'

export function toWebResponse(response: HttpClientResponse.HttpClientResponse) {
	// 204/205/304 are "null body statuses": pairing one with a non-null body makes the WHATWG
	// Response constructor throw `Invalid response status code N` on Node. Drain the upstream body
	// (releasing any socket-backed reader) and return a body-less response, rather than building a
	// ReadableStream we'd immediately discard.
	if (isNullBodyStatus(response.status)) {
		return Stream.runDrain(response.stream).pipe(
			Effect.ignore,
			Effect.as(
				new Response(null, {
					status: response.status,
					headers: copyProxyHeaders(response.headers),
				}),
			),
		)
	}

	const responseStream: Stream.Stream<Uint8Array, HttpClientError> = response.stream
	return Stream.toReadableStreamEffect(responseStream).pipe(
		Effect.map(
			(body) =>
				new Response(body, {
					status: response.status,
					headers: copyProxyHeaders(response.headers),
				}),
		),
	)
}
