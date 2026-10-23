import * as Sentry from '@sentry/effect/server'
import { extraErrorDataIntegration, honoIntegration, zodErrorsIntegration } from '@sentry/node'
import * as Layer from 'effect/Layer'
import * as Logger from 'effect/Logger'
import * as Tracer from 'effect/Tracer'

type SentryEvent = Parameters<NonNullable<Parameters<typeof Sentry.effectLayer>[0]['beforeSend']>>[0]

const BENIGN_SOCKET_CODES = new Set(['UND_ERR_SOCKET', 'ECONNRESET', 'EPIPE', 'ERR_STREAM_PREMATURE_CLOSE'])

/**
 * True when the event is an uncaughtException/unhandledRejection-mechanism benign socket teardown
 * (e.g. UND_ERR_SOCKET "other side closed" after an upstream response settled). These are recovered
 * by the L1 socket listener + the index.ts backstop, so they are NOT fatal and should not be sent.
 * Our explicit L1 captureException warnings carry a handled mechanism and are not matched here.
 */
export function isRecoveredSocketUncaught(event: SentryEvent): boolean {
	const values = event.exception?.values
	if (!values?.length) return false
	return values.some((v) => {
		const mech = v.mechanism?.type
		if (mech !== 'onuncaughtexception' && mech !== 'onunhandledrejection') return false
		if (v.type === 'SocketError') return true
		const msg = v.value ?? ''
		if (/other side closed|socket hang up/i.test(msg)) return true
		const ctx = (event.contexts?.[v.type ?? ''] ?? event.contexts?.SocketError) as { code?: unknown } | undefined
		return typeof ctx?.code === 'string' && BENIGN_SOCKET_CODES.has(ctx.code)
	})
}

// Unset means Sentry stays off, so builds from source report nowhere.
const SENTRY_DSN = process.env.SENTRY_DSN || undefined

const SENSITIVE_KEYS = [
	'store',
	'state',
	'session',
	'conversation',
	'approval',
	'messages',
	'prompt',
	'file_content',
	'working_directory',
	'api_key',
	'token',
	'password',
	'secret',
	'key',
	'auth',
	'credential',
	'content',
	'user_message',
	'assistant_message',
	'body',
	'request_body',
	'response_body',
	'where',
	'shape_id',
]

/**
 * Recursively scrub a value captured into a Sentry context. Used for the
 * per-error data attached by extraErrorDataIntegration (event.contexts.<ErrorName>,
 * e.g. a FetchError's `url`/`status`/`headers`). URL secrets are redacted and
 * sensitively-named fields are dropped — matching is on field *names*, not values,
 * so a sync URL whose path contains "sessions"/"conversation" is preserved.
 */
function scrubContextValue(value: unknown, depth = 0): unknown {
	if (typeof value === 'string') {
		return value
			.replace(/api_key=[^&]+/g, 'api_key=REDACTED')
			.replace(/token=[^&]+/g, 'token=REDACTED')
			.replace(/secret=[^&]+/g, 'secret=REDACTED')
			.replace(/query=[^&]+/g, 'query=REDACTED')
			.replace(/where=[^&]+/g, 'where=REDACTED')
	}
	if (value === null || typeof value !== 'object' || depth >= 4) return value
	if (Array.isArray(value)) return value.map((item) => scrubContextValue(item, depth + 1))
	const scrubbed: Record<string, unknown> = {}
	for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
		const lower = key.toLowerCase()
		if (lower.includes('cookie') || SENSITIVE_KEYS.some((sensitive) => lower.includes(sensitive))) {
			continue
		}
		scrubbed[key] = scrubContextValue(val, depth + 1)
	}
	return scrubbed
}

function scrubSensitiveData(event: SentryEvent): SentryEvent {
	if (event.contexts?.state) {
		delete event.contexts.state
	}

	if (event.request?.url) {
		event.request.url = event.request.url
			.replace(/api_key=[^&]+/g, 'api_key=REDACTED')
			.replace(/token=[^&]+/g, 'token=REDACTED')
			.replace(/query=[^&]+/g, 'query=REDACTED')
			.replace(/where=[^&]+/g, 'where=REDACTED')
	}

	if (event.request?.headers) {
		const cleanHeaders = { ...event.request.headers }
		delete cleanHeaders.Authorization
		delete cleanHeaders['X-API-Key']
		delete cleanHeaders.Cookie
		event.request.headers = cleanHeaders
	}

	if (event.request?.data) {
		delete event.request.data
	}

	if (event.breadcrumbs) {
		event.breadcrumbs = event.breadcrumbs
			.filter((breadcrumb) => breadcrumb.category !== 'console')
			.map((breadcrumb) => {
				if (breadcrumb.data) {
					const sanitized = { ...breadcrumb.data }
					for (const key of SENSITIVE_KEYS) {
						delete sanitized[key]
					}
					breadcrumb.data = sanitized
				}
				return breadcrumb
			})
	}

	if (event.extra) {
		Object.keys(event.extra).forEach((key) => {
			if (SENSITIVE_KEYS.some((sensitive) => key.toLowerCase().includes(sensitive))) {
				delete event.extra?.[key]
			}
			if (typeof event.extra?.[key] === 'object' && event.extra?.[key] !== null) {
				const str = JSON.stringify(event.extra?.[key])
				if (SENSITIVE_KEYS.some((sensitive) => str.toLowerCase().includes(sensitive))) {
					delete event.extra?.[key]
				}
			}
		})
	}

	// Scrub the per-error data added by extraErrorDataIntegration, which lands
	// under event.contexts keyed by the error name (e.g. contexts.FetchError =
	// { url, status, headers, … }). Field-level scrub so the shape URL survives.
	if (event.contexts) {
		for (const name of Object.keys(event.contexts)) {
			if (name === 'trace' || name === 'replay' || name === 'profile') continue
			const ctx = event.contexts[name]
			if (ctx == null) continue
			event.contexts[name] = scrubContextValue(ctx) as typeof ctx
		}
	}

	return event
}

const env = process.env.SENTRY_ENVIRONMENT ?? 'local'
const forceEnable = process.env.SENTRY_FORCE_ENABLE_IN_LOCAL_ENV === 'true'
const taskId = process.env.HOSTNAME ?? 'local'
const ecsService = 'riptide-electric-proxy'
const isLocal = env === 'local'
const denseJsonConsoleLogger = Logger.withConsoleLog(Logger.formatJson)
const effectLoggers = isLocal ? [denseJsonConsoleLogger] : [denseJsonConsoleLogger, Sentry.SentryEffectLogger]

export const SentryLive = Layer.mergeAll(
	Sentry.effectLayer({
		debug: forceEnable,
		dsn: SENTRY_DSN,
		enabled: SENTRY_DSN !== undefined && (env !== 'local' || forceEnable),
		sendDefaultPii: false,
		environment: env,
		release: process.env.SENTRY_RELEASE,
		serverName: taskId,
		// extraErrorDataIntegration surfaces non-standard Error properties (e.g. a
		// FetchError's `url`/`status`) as Additional Data; scrubbed in scrubSensitiveData.
		integrations: [honoIntegration(), zodErrorsIntegration(), extraErrorDataIntegration()],
		enableLogs: true,
		tracesSampler: (samplingContext) => {
			if (samplingContext.parentSampled !== undefined) {
				return samplingContext.parentSampled ? 1 : 0
			}
			const rawUrl = samplingContext.attributes?.['http.url']
			const url = typeof rawUrl === 'string' ? rawUrl : ''
			if (url.endsWith('/health') || url.endsWith('/ready') || /^https?:\/\/[^/]+\/?$/.test(url)) {
				return 0
			}
			if (env === 'local') return 1.0
			if (env === 'devcloud') return 0.001
			if (env === 'beta') return 0.0001
			return 0.0001
		},
		beforeSend(event) {
			if (isRecoveredSocketUncaught(event)) return null
			return scrubSensitiveData(event)
		},
		beforeSendMetric(metric) {
			if (metric.name.startsWith('effect_fiber_')) {
				return null
			}

			metric.attributes = {
				...metric.attributes,
				ecs_task_id: taskId,
				ecs_service: ecsService,
			}
			return metric
		},
		beforeBreadcrumb(breadcrumb) {
			if (breadcrumb.category === 'console') {
				return null
			}
			return breadcrumb
		},
	}),
	Layer.succeed(Tracer.Tracer, Sentry.SentryEffectTracer),
	Logger.layer(effectLoggers),
	Sentry.SentryEffectMetricsLayer,
)

export { Sentry }
