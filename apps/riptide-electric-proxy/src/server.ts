/**
 * Core server factory - no side effects, no env vars.
 * Import this for testing or when you want to create an app with custom config.
 */

import { serve } from '@hono/node-server'
import { Effect } from 'effect'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { compress } from 'hono/compress'
import { cors } from 'hono/cors'

import type { AppConfig, SimpleAuthContext } from './app-config'
import { ConnectionMetrics } from './lib/effect/connection-metrics.service'
import { attachGlobalErrorHandler } from './routes/error-handler'
import { createResponseEditorCollaborationApp } from './routes/response-editor-collaboration'
import { createStreamsApp } from './routes/streams'
import { createV1App } from './routes/v1'
import { createV2App } from './routes/v2'
import { createV3App } from './routes/v3'

// Re-export for convenience
export type { AppConfig, SimpleAuthContext } from './app-config'
export { type AppRuntime, createTestAppRuntime } from './lib/effect/runtime'

export function createApp(config: AppConfig) {
	const app = new Hono()

	// Body size limit - prevents OOM from large payloads
	app.use(
		'*',
		bodyLimit({
			maxSize: 10 * 1024 * 1024, // 10 MB
			onError: (c) => c.json({ error: 'Request body too large', maxSize: '10MB' }, 413),
		}),
	)

	attachGlobalErrorHandler(app)
	app.use(cors())
	app.use('*', async (_c, next) => {
		return config.effectRuntime.runPromise(
			Effect.gen(function* () {
				const metrics = yield* ConnectionMetrics
				return yield* metrics.trackRequest(Effect.promise(() => next()))
			}),
		)
	})
	app.get('/', async (c) => c.json({ status: 'online' }))

	// Electric serves everything uncompressed by design and expects the proxy in
	// front of it to negotiate encoding, so gzip all responses here. Streaming
	// routes opt out automatically by declaring `Cache-Control: no-transform`
	// (see routes/streams.ts) — compress honors it, as do compliant intermediaries.
	app.use('*', compress())

	const v1App = createV1App(config)
	const v2App = createV2App(config)
	const v3App = createV3App(config)
	const streamsApp = createStreamsApp(config, { taskDiffs: false, prStatus: false })
	const v2StreamsApp = createStreamsApp(config, { sessions: false })

	// Handle collaboration before the Electric v2 wildcard middleware.
	app.route('/', createResponseEditorCollaborationApp(config))
	app.route('/v1', v1App)
	app.route('/v2', v2App)
	app.route('/v3', v3App)
	app.route('/v2/streams', v2StreamsApp)
	app.route('/streams', streamsApp)

	return app
}

/**
 * Starts the server programmatically. Useful for integration tests.
 * Returns a Bun.serve-compatible subset which can be stopped with server.stop()
 */
export function startServer(app: Hono, port: number = 8888) {
	const server = serve({ fetch: app.fetch, port })
	const address = server.address()
	const assignedPort = typeof address === 'object' && address !== null ? address.port : port

	return {
		port: assignedPort,
		stop: (_force?: boolean) => server.close(),
	}
}

declare module 'hono' {
	interface ContextVariableMap {
		electricOriginUrl: URL
		authContext: SimpleAuthContext
	}
}
