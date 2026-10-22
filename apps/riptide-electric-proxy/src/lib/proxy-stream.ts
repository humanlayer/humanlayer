import { StatusCodes } from 'http-status-codes'

import { copyProxyHeaders, copyProxyRequestHeaders, isNullBodyStatus } from './effect/proxy-headers'
import { Sentry } from './effect/sentry.service'
import { logger } from './logger'

type IncomingRequest = {
	method: string
	header: (name: string) => string | undefined
	raw: Request
}

function buildHeaders(incomingRequest: IncomingRequest) {
	const headers = copyProxyRequestHeaders(incomingRequest.raw.headers)

	const contentType = incomingRequest.header('Content-Type')
	if (contentType) headers.set('Content-Type', contentType)

	return headers
}

export async function proxyToStream(originUrl: URL, incomingRequest: IncomingRequest): Promise<Response> {
	const hasBody = !['GET', 'HEAD'].includes(incomingRequest.method)

	let response: Response
	try {
		logger.info('Fetching upstream Durable Streams request', {
			method: incomingRequest.method,
			url: originUrl.toString(),
			hasBody,
		})
		response = await fetch(originUrl, {
			method: incomingRequest.method,
			headers: buildHeaders(incomingRequest),
			body: hasBody ? incomingRequest.raw.body : undefined,
			duplex: hasBody ? 'half' : undefined,
		} as RequestInit)
		logger.info('Upstream Durable Streams response', {
			method: incomingRequest.method,
			url: originUrl.toString(),
			status: response.status,
			statusText: response.statusText,
		})
	} catch (error) {
		logger.error('Fetch error from upstream Durable Streams server:', error)
		Sentry.captureException(error, {
			tags: { error_type: 'durable_streams_proxy_fetch' },
		})
		return new Response(JSON.stringify({ error: 'Unable to connect to Durable Streams server' }), {
			status: StatusCodes.BAD_GATEWAY,
			statusText: 'Bad Gateway',
			headers: { 'Content-Type': 'application/json' },
		})
	}

	// 204/205/304 must not carry a body (the Response constructor throws on Node otherwise).
	return new Response(isNullBodyStatus(response.status) ? null : response.body, {
		status: response.status,
		statusText: response.statusText,
		headers: copyProxyHeaders(response.headers),
	})
}
