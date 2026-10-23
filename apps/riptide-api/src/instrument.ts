import { ORPCInstrumentation } from '@orpc/otel'
import type { ErrorEvent } from '@sentry/node'
import * as Sentry from '@sentry/node'

// Keys that should NEVER be sent to Sentry - contains user content or secrets
// Pattern from: apps/wui/src/lib/telemetry/sentry.ts:188-199
//
// NOTE: `ai_fallback_exhausted` Sentry events carry `primary_error_message`,
// `primary_status_code`, `fallback_error_message`, `fallback_status_code`,
// and the `model_alias` tag. None of these key names match the substring
// list below, so they pass through unchanged. If you add new keys here, audit
// the `packages/ai/src/reliable-language-model` Sentry payload to
// confirm fallback telemetry is not silently scrubbed.
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
	'body', // Request/response bodies may contain user data
	'request_body',
	'response_body',
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

/**
 * Scrub sensitive data from Sentry events before sending
 * Pattern from: apps/wui/src/lib/telemetry/sentry.ts:127-216
 */
function scrubSensitiveData(event: ErrorEvent): ErrorEvent {
	// Remove state contexts
	if (event.contexts?.state) {
		delete event.contexts.state
	}

	// Scrub request data
	if (event.request?.url) {
		event.request.url = event.request.url
			.replace(/api_key=[^&]+/g, 'api_key=REDACTED')
			.replace(/token=[^&]+/g, 'token=REDACTED')
			.replace(/query=[^&]+/g, 'query=REDACTED')
	}

	// Remove sensitive headers
	if (event.request?.headers) {
		const cleanHeaders = { ...event.request.headers }
		delete cleanHeaders.Authorization
		delete cleanHeaders['X-API-Key']
		delete cleanHeaders.Cookie
		event.request.headers = cleanHeaders
	}

	// Never send request body - may contain user prompts
	if (event.request?.data) {
		delete event.request.data
	}

	// Scrub breadcrumbs
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

	// Scrub extra context
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
// Unset means Sentry stays off, so builds from source report nowhere.
const dsn = process.env.SENTRY_DSN || undefined
const sentryGlobal = globalThis as typeof globalThis & { __riptideApiSentryInitialized?: boolean }

if (!sentryGlobal.__riptideApiSentryInitialized) {
	Sentry.init({
		debug: forceEnable,
		dsn,
		enabled: dsn !== undefined && (env !== 'local' || forceEnable),
		enableLogs: true,
		sendDefaultPii: false, // Disable automatic PII capture
		environment: env,
		release: process.env.SENTRY_RELEASE,
		tracesSampler: (samplingContext) => {
			// Always honor parent sampling decision for distributed traces
			if (samplingContext.parentSampled !== undefined) {
				return samplingContext.parentSampled ? 1 : 0
			}
			const rawUrl = samplingContext.attributes?.['http.url']
			const url = typeof rawUrl === 'string' ? rawUrl : ''
			// Drop health checks and root status endpoint
			if (url.endsWith('/health') || url.endsWith('/ready') || /^https?:\/\/[^/]+\/?$/.test(url)) {
				return 0
			}
			if (env === 'local') return 1.0
			if (env === 'devcloud') return 0.001
			if (env === 'beta') return 0.0001
			return 0.0001 // prod
		},
		// extraErrorDataIntegration surfaces non-standard Error properties (e.g. a
		// FetchError's `url`/`status`) as Additional Data; scrubbed in scrubSensitiveData.
		integrations: [Sentry.honoIntegration(), Sentry.zodErrorsIntegration(), Sentry.extraErrorDataIntegration()],
		openTelemetryInstrumentations: [new ORPCInstrumentation()],

		beforeSend(event, hint) {
			// Drop expected auth noise: an expired JWT ("exp" in the past). Tokens are
			// meant to expire and clients then re-auth/refresh, so these are never worth
			// reporting (they otherwise dominate volume, e.g. RIPTIDE-API-D9). jose sets a
			// stable `.code` that survives minification, unlike the renamed class name.
			const err = hint?.originalException as { code?: unknown; message?: unknown } | undefined
			if (
				err?.code === 'ERR_JWT_EXPIRED' ||
				(typeof err?.message === 'string' && err.message.includes('"exp" claim timestamp check failed'))
			) {
				return null
			}
			return scrubSensitiveData(event)
		},

		beforeBreadcrumb(breadcrumb) {
			// Never capture console logs - may contain user data
			if (breadcrumb.category === 'console') {
				return null
			}
			return breadcrumb
		},
	})

	sentryGlobal.__riptideApiSentryInitialized = true
}

export { Sentry }
