import './instrument'
import 'zod/compile'
import { Server } from 'node:http'

import { serve } from '@hono/node-server'
import * as Sentry from '@sentry/node'

import { validateDaemonToken } from './auth/daemon-tokens'
import { db } from './lib/db'
import { makeProxyRuntimeConfig } from './lib/effect/proxy-runtime-config.service'
import { createAppRuntime, makeProductionAppLayer } from './lib/effect/runtime'
import { logger } from './lib/logger'
import { resolveProxyRuntimeEnvironment } from './runtime-environment'
import { createApp } from './server'
import { resolveElectricProxyPort } from './server-port'

const {
	electricShapeUrl: ELECTRIC_SHAPE_URL,
	electricSecret: ELECTRIC_SECRET,
	durableStreamsOrigin: DURABLE_STREAMS_ORIGIN,
} = resolveProxyRuntimeEnvironment(process.env)
const PORT = resolveElectricProxyPort({
	RIPTIDE_ELECTRIC_PROXY_PORT: process.env.RIPTIDE_ELECTRIC_PROXY_PORT,
	PORT: process.env.PORT,
})

logger.info(`Loaded ELECTRIC_SHAPE_URL: ${ELECTRIC_SHAPE_URL}`)
logger.info(`Loaded DURABLE_STREAMS_ORIGIN: ${DURABLE_STREAMS_ORIGIN}`)

if (ELECTRIC_SECRET) {
	logger.info('Successfully loaded ELECTRIC_SECRET from environment')
} else if (process.env.NODE_ENV === 'production') {
	logger.error('ELECTRIC_SECRET not found in process environment in production!')
	throw new Error('ELECTRIC_SECRET not found in process environment in production mode.')
} else {
	logger.warn('ELECTRIC_SECRET not found in process environment, this is ok in non-production.')
}

const appRuntime = createAppRuntime(
	makeProductionAppLayer(
		makeProxyRuntimeConfig({
			electricShapeUrl: ELECTRIC_SHAPE_URL,
			durableStreamsOrigin: DURABLE_STREAMS_ORIGIN,
		}),
	),
)
const app = createApp({
	electricShapeUrl: ELECTRIC_SHAPE_URL,
	electricSecret: ELECTRIC_SECRET,
	durableStreamsOrigin: DURABLE_STREAMS_ORIGIN,
	effectRuntime: appRuntime,
	validateDaemonToken,
	db,
})

const server = serve({ fetch: app.fetch, port: PORT })
if (!(server instanceof Server)) {
	throw new Error(`Expected http.Server but got ${server.constructor.name}`)
}
server.keepAliveTimeout = 0

// Defense-in-depth backstop. The undici-proxy-fetch handler covers the known upstream-body-abort
// path; this catches any OTHER stray async socket error so it can't take down the task. Sentry's
// OnUncaughtException integration already captures the error (and, now that this listener exists, it
// stops force-exiting and defers the exit to us). So we do NOT re-capture here — we only own the exit
// decision: benign upstream socket teardown must not kill the task; anything else is a real bug.
const BENIGN_SOCKET_ERROR_CODES = new Set(['UND_ERR_SOCKET', 'ECONNRESET', 'EPIPE', 'ERR_STREAM_PREMATURE_CLOSE'])
const BENIGN_SOCKET_ERROR_NAMES = new Set(['SocketError'])
const benignSocketCode = (error: unknown): string | undefined => {
	const e = error as { code?: unknown; name?: unknown; message?: unknown } | null
	const code = typeof e?.code === 'string' ? e.code : undefined
	if (code && BENIGN_SOCKET_ERROR_CODES.has(code)) return code
	if (typeof e?.name === 'string' && BENIGN_SOCKET_ERROR_NAMES.has(e.name)) return e.name
	if (typeof e?.message === 'string' && /other side closed|socket hang up/i.test(e.message)) return 'UND_ERR_SOCKET'
	return undefined
}
process.on('uncaughtException', (error) => {
	const code = benignSocketCode(error)
	if (code) {
		logger.warn(`recovered from uncaught socket error (${code}); not exiting`)
		return
	}
	logger.error(`uncaught exception; exiting: ${String(error)}`)
	void Sentry.flush(2000).finally(() => process.exit(1))
})

const shutdown = () => {
	server.close((err) => {
		if (err) {
			console.error(err)
			process.exit(1)
		}

		process.exit(0)
	})
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
