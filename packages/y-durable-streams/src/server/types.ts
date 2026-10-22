// Derived from upstream 0.2.8; see README.md and LICENSE.
import { Context, Data, type Effect } from 'effect'

export const YJS_STREAM_TTL_SECONDS = 3600
export const YJS_CONTENT_TYPE = 'application/octet-stream'

export class YjsGatewayError extends Data.TaggedError('YjsGatewayError')<{
	readonly cause: unknown
}> {}

export class YjsStorageConfig extends Context.Service<YjsStorageConfig, { readonly baseUrl: string }>()(
	'YjsStorageConfig',
) {}

export interface EmbeddedYjsHandler {
	handle(request: Request, signal: AbortSignal): Effect.Effect<Response, YjsGatewayError>
}

export class YjsGateway extends Context.Service<YjsGateway, EmbeddedYjsHandler>()('YjsGateway') {}

/** One parser is used before authorization and again by the handler. Never use truthiness for awareness. */
export function parseYjsQuery(url: URL): { awareness: boolean } | null {
	for (const key of url.searchParams.keys()) {
		if (!['awareness', 'offset', 'live', 'cursor'].includes(key) || url.searchParams.getAll(key).length !== 1)
			return null
	}
	const awareness = url.searchParams.get('awareness')
	if (awareness !== null && awareness !== 'default') return null
	const offset = url.searchParams.get('offset')
	if (offset !== null && !/^(?:-1|now|[0-9a-f]{16}_[0-9a-f]{16})$/.test(offset)) return null
	const live = url.searchParams.get('live')
	if (live !== null && !['sse', 'long-poll', 'true'].includes(live)) return null
	return { awareness: awareness !== null }
}

export const YjsStreamPaths = {
	dsStream: (service: string, docPath: string) => `/v1/stream/yjs/${service}/docs/${docPath}/.updates`,
	awarenessStream: (service: string, docPath: string) =>
		`/v1/stream/yjs/${service}/docs/${docPath}/.awareness/default`,
}
