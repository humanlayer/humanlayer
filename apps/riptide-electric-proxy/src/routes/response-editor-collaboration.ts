import {
	RESPONSE_EDITOR_COLLABORATION_ROUTE,
	RESPONSE_EDITOR_DOCUMENT_ID,
} from '@humanlayer/streams/response-editor-collaboration'
import { parseYjsQuery } from '@humanlayer/y-durable-streams/server'
import { Effect } from 'effect'
import { Hono } from 'hono'

import type { AppConfig, SimpleAuthContext } from '../app-config'
import { Sentry } from '../lib/effect/sentry.service'
import { YjsGateway } from '../lib/effect/yjs-gateway.service'
import { getResponseEditorAccess } from '../lib/queries'
import { isUuid } from '../lib/validation'
import { createAuthMiddleware, noTransformResponses } from '../middleware'

export function createResponseEditorCollaborationApp(config: AppConfig) {
	const app = new Hono<{ Variables: { authContext: SimpleAuthContext } }>()
	app.use('/v2/collaboration/*', noTransformResponses)
	app.use('/v2/collaboration/*', createAuthMiddleware(config))
	app.all(RESPONSE_EDITOR_COLLABORATION_ROUTE, async (c) => {
		const organizationId = c.req.param('organizationId')
		const sessionId = c.req.param('sessionId')
		const url = new URL(c.req.url)
		const target = parseYjsQuery(url)
		if (!organizationId || !sessionId || !isUuid(organizationId) || !isUuid(sessionId) || !target)
			return c.body(null, 400)
		const method = c.req.method
		if (!['GET', 'HEAD', 'PUT', 'POST'].includes(method)) return c.body(null, 405)
		if ((method === 'PUT' || method === 'POST') && [...url.searchParams.keys()].some((key) => key !== 'awareness'))
			return c.body(null, 400)
		const auth = c.var.authContext
		// This route is for users only. A daemon token must not become a browser editing capability.
		if (auth.hostId || auth.organizationId !== organizationId) return c.body(null, 403)
		const access = await getResponseEditorAccess(config.db, { organizationId, sessionId, userId: auth.userId })
		if (
			!access.organizationMember ||
			(!target.awareness && (method === 'PUT' || method === 'POST') && !access.canPrompt)
		)
			return c.body(null, 403)
		const internal = new URL(
			`/v1/yjs/response-editor/docs/${organizationId}/${sessionId}/${RESPONSE_EDITOR_DOCUMENT_ID}`,
			url.origin,
		)
		internal.search = url.search
		const request = new Request(internal.href, {
			method,
			headers: c.req.raw.headers,
			body: method === 'PUT' || method === 'POST' ? await c.req.arrayBuffer() : undefined,
			signal: c.req.raw.signal,
		})
		return config.effectRuntime.runPromise(
			Effect.gen(function* () {
				const gateway = yield* YjsGateway
				return yield* gateway.handle(request, c.req.raw.signal).pipe(
					Effect.tapError((error) =>
						Effect.logError('Response editor gateway failed', error).pipe(
							Effect.andThen(Effect.sync(() => Sentry.captureException(error))),
						),
					),
					Effect.catchTag('YjsGatewayError', () => Effect.succeed(new Response(null, { status: 502 }))),
				)
			}),
		)
	})
	return app
}
