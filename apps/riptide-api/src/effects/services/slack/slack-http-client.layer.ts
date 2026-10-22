import { Config, Effect, Layer } from 'effect'
import * as HttpClient from 'effect/http/HttpClient'
import * as HttpClientRequest from 'effect/http/HttpClientRequest'

import { SlackHttpClient } from './slack-http-client.service'
import { SlackApiUnavailableError } from './slack.errors'

export const SlackHttpClientLive = Layer.effect(
	SlackHttpClient,
	Effect.gen(function* () {
		const apiBaseUrl = yield* Config.String('SLACK_API_BASE_URL').pipe(Config.withDefault('https://slack.com'))
		const httpClient = yield* HttpClient.HttpClient
		return SlackHttpClient.of({
			execute: (request) => {
				const path = request.url.split(/[?#]/, 1)[0] ?? ''
				const attributes = { method: request.method, path }
				return httpClient.execute(request.pipe(HttpClientRequest.prependUrl(apiBaseUrl))).pipe(
					Effect.tap((response) =>
						Effect.logInfo('Slack HTTP response').pipe(
							Effect.annotateLogs({ ...attributes, status: response.status }),
						),
					),
					// HttpClientError retains the complete request, including authorization headers and
					// form bodies. Do not allow credentials to cross into logging or Sentry as an error cause.
					Effect.catchTag('HttpClientError', () =>
						Effect.fail(
							new SlackApiUnavailableError({
								cause: { type: 'SlackHttpTransportError', method: request.method, path },
							}),
						),
					),
					Effect.withSpan('slack.http_request', { attributes }),
				)
			},
		})
	}),
)
