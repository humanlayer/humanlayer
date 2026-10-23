import { describe, it } from '@effect/vitest'
import { Cause, Effect, Exit, Stream } from 'effect'
import type { HttpClientResponse } from 'effect/http'

import { toWebResponse } from '../../src/lib/effect/http-client-response'

// toWebResponse only reads .status, .headers and .stream off the upstream response,
// so a minimal stub is enough. Crucially, .stream is always a non-null byte stream —
// which is exactly what makes pairing it with a null-body status illegal.
function makeUpstreamResponse(status: number, body: string) {
	return {
		status,
		headers: { 'content-type': 'text/plain' },
		stream: Stream.fromIterable([new TextEncoder().encode(body)]),
	} as unknown as HttpClientResponse.HttpClientResponse
}

// WHATWG "null body statuses": a Response with one of these MUST have a null body,
// otherwise the Response constructor throws `TypeError: Invalid response status code N`.
const NULL_BODY_STATUSES = [204, 205, 304]
// Representative statuses that carry a body — the fix must NOT strip these.
const BODY_STATUSES = [200, 404]

describe('toWebResponse', () => {
	it.effect('forwards null-body statuses (204/205/304) with a null body instead of throwing', ({ expect }) =>
		Effect.gen(function* () {
			for (const status of NULL_BODY_STATUSES) {
				// Faithful to production: the upstream answered with this status while the
				// proxy still has a (non-null) body stream in hand.
				const exit = yield* Effect.exit(toWebResponse(makeUpstreamResponse(status, 'unexpected upstream body')))

				// Surface the failure cause during the red run so we can confirm the diagnosis.
				if (Exit.isFailure(exit)) {
					yield* Effect.logError(`toWebResponse(${status}) →`, Cause.pretty(exit.cause))
				}

				expect(Exit.isSuccess(exit)).toBe(true)
				if (Exit.isSuccess(exit)) {
					expect(exit.value.status).toBe(status)
					expect(exit.value.body).toBeNull()
				}
			}
		}),
	)

	it.effect('preserves the body for statuses that allow one', ({ expect }) =>
		Effect.gen(function* () {
			for (const status of BODY_STATUSES) {
				const response = yield* toWebResponse(makeUpstreamResponse(status, 'hello'))
				expect(response.status).toBe(status)
				expect(response.body).not.toBeNull()
				expect(yield* Effect.promise(() => response.text())).toBe('hello')
			}
		}),
	)
})
