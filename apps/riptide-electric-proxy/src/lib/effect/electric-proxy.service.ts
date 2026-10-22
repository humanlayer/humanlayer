import { Context, Effect, Layer, Schema } from 'effect'
import { HttpClientRequest } from 'effect/http'

import type { ElectricRequestContext } from '../electric-error-handler'
import { handleElectricError, headerIndicatesCapturableError, redactUrl } from '../electric-error-handler'
import { logger } from '../logger'
import { ConnectionMetrics } from './connection-metrics.service'
import { ElectricProxyHttpClient } from './electric-http-client.service'
import { toWebResponse } from './http-client-response'

export type ElectricIncomingRequest = { method: string; text: () => Promise<string> }

export class ElectricProxy extends Context.Service<
	ElectricProxy,
	{
		readonly proxyShapeRequest: (
			url: URL,
			context?: Omit<ElectricRequestContext, 'electricUrl'>,
			incomingRequest?: ElectricIncomingRequest,
		) => Effect.Effect<Response>
	}
>()('ElectricProxy') {}

function makeBadGatewayResponse() {
	return new Response(JSON.stringify({ error: 'Unable to connect to Electric' }), {
		status: 502,
		statusText: 'Bad Gateway',
		headers: { 'Content-Type': 'application/json' },
	})
}

// Electric 1.7.12 ServeShapePlug.merge_body_params treats these flat fields as
// subset parameters, but merges ALL top-level fields over the URL when `subset`
// is an object. Normalize both forms; never forward arbitrary shape/auth fields.
// Values are validated by Electric; this boundary owns the allowed field names.
const ElectricSubsetBody = Schema.Struct({
	where: Schema.optionalKey(Schema.Unknown),
	params: Schema.optionalKey(Schema.Unknown),
	order_by: Schema.optionalKey(Schema.Unknown),
	limit: Schema.optionalKey(Schema.Unknown),
	offset: Schema.optionalKey(Schema.Unknown),
	where_expr: Schema.optionalKey(Schema.Unknown),
	order_by_expr: Schema.optionalKey(Schema.Unknown),
})

const ElectricPostBody = Schema.fromJsonString(
	Schema.Struct({
		...ElectricSubsetBody.fields,
		subset: Schema.optionalKey(ElectricSubsetBody),
		handle: Schema.optionalKey(Schema.Unknown),
		live: Schema.optionalKey(Schema.Unknown),
		live_sse: Schema.optionalKey(Schema.Unknown),
		experimental_live_sse: Schema.optionalKey(Schema.Unknown),
		log: Schema.optionalKey(Schema.Unknown),
	}),
)

function buildElectricRequest(url: URL, incomingRequest?: ElectricIncomingRequest) {
	if (incomingRequest?.method === 'POST') {
		return Effect.promise(() => incomingRequest.text()).pipe(
			Effect.flatMap((body) => Schema.decodeUnknownEffect(ElectricPostBody)(body === '' ? '{}' : body)),
			Effect.map(({ subset, handle, live, live_sse, experimental_live_sse, log, ...flatSubset }) => {
				const controls = { handle, live, live_sse, experimental_live_sse, log }
				// Flat offset is subset pagination; with explicit `subset`, root offset
				// is the shape-log cursor. Do not confuse the two or change empty-body behavior.
				const body =
					subset === undefined
						? { ...controls, subset: Object.keys(flatSubset).length > 0 ? flatSubset : undefined }
						: { ...controls, offset: flatSubset.offset, subset }
				return HttpClientRequest.post(url.toString(), {
					headers: { 'Content-Type': 'application/json' },
				}).pipe(HttpClientRequest.bodyText(JSON.stringify(body), 'application/json'))
			}),
		)
	}

	return Effect.succeed(HttpClientRequest.get(url.toString()))
}

function logElectricErrorResponse(response: Response, url: URL, context?: Omit<ElectricRequestContext, 'electricUrl'>) {
	if (!context || !headerIndicatesCapturableError(response.status)) return

	const clonedResponse = response.clone()
	const { status, statusText } = response
	logger.error('Handling error response from upstream electric (details to follow):', status)
	void clonedResponse
		.text()
		.then((body) =>
			handleElectricError(status, statusText, body, {
				...context,
				electricUrl: url,
			}),
		)
		.catch((err) => {
			logger.error('Error from upstream electric:', err)
		})
}

export const ElectricProxyLive = Layer.effect(
	ElectricProxy,
	Effect.gen(function* () {
		const metrics = yield* ConnectionMetrics
		const httpClient = yield* ElectricProxyHttpClient

		return ElectricProxy.of({
			proxyShapeRequest: (url, context, incomingRequest) =>
				metrics.withElectricConnection(
					Effect.gen(function* () {
						const request = yield* buildElectricRequest(url, incomingRequest)
						const response = yield* httpClient.execute(request)
						const webResponse = yield* toWebResponse(response)
						logElectricErrorResponse(webResponse, url, context)
						return webResponse
					}).pipe(
						Effect.catchTag('SchemaError', () =>
							Effect.succeed(
								new Response(
									JSON.stringify({ error: 'Expected a JSON object with an optional subset object' }),
									{ status: 400, headers: { 'Content-Type': 'application/json' } },
								),
							),
						),
						Effect.catch((cause) =>
							Effect.sync(() => {
								logger.error(`Fetch error from upstream electric at ${redactUrl(url)}:`, cause)
								return makeBadGatewayResponse()
							}),
						),
					),
				),
		})
	}),
)
