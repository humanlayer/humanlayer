import type { ErrorEvent } from '@sentry/bun'
import * as Sentry from '@sentry/bun'

import { BUILD_TYPE, BUILD_VERSION, COMMIT_HASH, SENTRY_DSN, SENTRY_ENVIRONMENT } from './lib/macros'

// Keys that should NEVER be sent to Sentry - contains user content or secrets
// Pattern from: apps/wui/src/lib/telemetry/sentry.ts:188-199
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
	'content', // Agent/Claude content
	'user_message', // User input
	'assistant_message', // AI responses
	'stdin', // Process input
	'stdout', // Process output
	'stderr', // Process errors (may contain user code)
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
	// Remove any reference to state stores completely
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

	// Scrub breadcrumbs for sensitive data
	if (event.breadcrumbs) {
		event.breadcrumbs = event.breadcrumbs
			.filter((breadcrumb) => {
				// Remove breadcrumbs that might contain process output
				if (breadcrumb.category === 'console') {
					return false
				}
				return true
			})
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

	// Aggressively scrub extra context data
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

const isLocal = (SENTRY_ENVIRONMENT ?? 'local') === 'local'
const tracesSampleRate = ['local', 'dev', 'beta'].includes(BUILD_TYPE ?? 'local') ? 1 : 0.0001

Sentry.init({
	dsn: SENTRY_DSN,
	enabled: SENTRY_DSN !== undefined && !isLocal,
	enableLogs: true,
	ignoreErrors: [
		/certificate/i,
		'ERR_TLS_CERT_ALTNAME_INVALID',
		'self signed certificate',
		'unable to verify the first certificate',
		'unknown certificate verification error',
		'socket connection was closed unexpectedly',
	],
	// SENTRY_ENVIRONMENT is set at build time (prod/devcloud), falls back to 'local' for dev mode
	environment: SENTRY_ENVIRONMENT ?? 'local',
	release: BUILD_VERSION,
	tracesSampleRate,
	// extraErrorDataIntegration surfaces non-standard Error properties (e.g. a
	// FetchError's `url`/`status`) as Additional Data; scrubbed in scrubSensitiveData.
	integrations: [Sentry.zodErrorsIntegration(), Sentry.extraErrorDataIntegration()],

	// Scrub sensitive data before sending
	beforeSend(event) {
		const message = event.exception?.values?.[0]?.value ?? event.message ?? ''
		if (/stream not found/i.test(message) || /Unable to connect to Durable Streams server/i.test(message)) {
			return null
		}
		return scrubSensitiveData(event)
	},

	// Filter breadcrumbs that might contain sensitive data
	beforeBreadcrumb(breadcrumb) {
		// Never capture console logs - may contain user prompts or agent output
		if (breadcrumb.category === 'console') {
			return null
		}
		return breadcrumb
	},
})

Sentry.setContext('build', {
	build_type: BUILD_TYPE,
	build_version: BUILD_VERSION,
	commit_hash: COMMIT_HASH,
})

Sentry.setTag('build_type', BUILD_TYPE ?? 'unknown')
Sentry.setTag('build_version', BUILD_VERSION ?? 'dev')
Sentry.setTag('sentry_environment', SENTRY_ENVIRONMENT ?? 'local')

export { Sentry }
