import { Context, type Effect } from 'effect'
import type { HttpClientRequest } from 'effect/http/HttpClientRequest'
import type { HttpClientResponse } from 'effect/http/HttpClientResponse'

import type { SlackApiUnavailableError } from './slack.errors'

export type SlackHttpClientShape = {
	readonly execute: (request: HttpClientRequest) => Effect.Effect<HttpClientResponse, SlackApiUnavailableError>
}

export class SlackHttpClient extends Context.Service<SlackHttpClient, SlackHttpClientShape>()('SlackHttpClient') {}
