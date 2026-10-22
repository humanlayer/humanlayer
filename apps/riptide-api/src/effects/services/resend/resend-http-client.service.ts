import { Context, type Effect } from 'effect'
import type { HttpClientRequest } from 'effect/http/HttpClientRequest'
import type { HttpClientResponse } from 'effect/http/HttpClientResponse'

import type { ResendTransportError } from './resend-errors'

export type ResendHttpClientShape = {
	readonly execute: (request: HttpClientRequest) => Effect.Effect<HttpClientResponse, ResendTransportError>
}

/** Authenticated Resend HTTP transport used by Resend API procedures. */
export class ResendHttpClient extends Context.Service<ResendHttpClient, ResendHttpClientShape>()('ResendHttpClient') {}
