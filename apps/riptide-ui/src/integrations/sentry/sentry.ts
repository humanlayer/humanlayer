import * as Sentry from '@sentry/react'
import type { AnyRouter } from '@tanstack/react-router'

import { buildConfig } from '@/lib/config'
import { logger } from '@/lib/logger'

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
]

// Identifier fields that should survive SENSITIVE_KEYS scrubbing.
// Checked as exact match (lowercased) before the substring loop.
// NOTE: several of these contain a SENSITIVE_KEYS substring ("conversation",
// "messages", "session") but are opaque ids / sequence numbers carrying no user
// content, so they must be exact-match allowlisted or the substring loop drops them
// (e.g. "conversationEventId" → "conversation", "messageSeq" → "messages").
const IDENTIFIER_ALLOWLIST = [
	'sessionid',
	'taskid',
	'artifactid',
	'action',
	'transactionid',
	'conversationeventid',
	'blocksessionid',
	'messageseq',
	'blockseq',
]

export function initializeSentry(router: AnyRouter): void {
	const forceEnable = import.meta.env.VITE_PUBLIC_SENTRY_FORCE_ENABLE_IN_LOCAL_ENV === 'true'

	if (import.meta.env.DEV && !forceEnable) {
		logger.info('Sentry initialization skipped (local development)')
		return
	}

	// Builds from source have no DSN, so they report nowhere.
	const dsn = import.meta.env.VITE_PUBLIC_SENTRY_DSN
	if (!dsn) {
		logger.info('Sentry initialization skipped (no VITE_PUBLIC_SENTRY_DSN)')
		return
	}

	// Read origins directly to avoid importing from modules with heavy/circular deps
	const apiOrigin = import.meta.env.VITE_PUBLIC_RIPTIDE_API_ORIGIN || 'http://localhost:8700'
	const syncOrigin = import.meta.env.VITE_PUBLIC_SYNC_ORIGIN
	const tracePropagationTargets = ['localhost', apiOrigin]
	if (syncOrigin) tracePropagationTargets.push(syncOrigin)

	const env = forceEnable ? 'local' : buildConfig.sentryEnvironment

	try {
		Sentry.init({
			dsn,
			environment: env,
			release: buildConfig.version,

			tracesSampler: (samplingContext) => {
				// Honor parent sampling decision for distributed traces
				if (samplingContext.parentSampled !== undefined) {
					return samplingContext.parentSampled ? 1 : 0
				}
				if (env === 'local') return 1.0
				if (env === 'devcloud') return 1.0
				if (env === 'beta') return 0.0001
				return 0.0001 // prod
			},

			// Inject sentry-trace + baggage headers into outgoing requests to our backends
			tracePropagationTargets,

			replaysSessionSampleRate: 0,
			replaysOnErrorSampleRate: 0,

			beforeSend(event: Sentry.ErrorEvent) {
				return scrubSensitiveData(event)
			},

			beforeBreadcrumb(breadcrumb) {
				// Never capture console logs that might contain sensitive data
				if (breadcrumb.category === 'console') {
					return null
				}

				// Sanitize HTTP requests
				if (breadcrumb.category === 'fetch' || breadcrumb.category === 'xhr') {
					if (breadcrumb.data?.url) {
						// Don't log session API calls at all - contain user prompts
						if (breadcrumb.data.url.includes('/api/v1/sessions')) {
							return null
						}
						// Don't log conversation events - contain agent output
						if (breadcrumb.data.url.includes('/conversation')) {
							return null
						}
						breadcrumb.data.url = breadcrumb.data.url
							.replace(/query=[^&]*/g, 'query=[FILTERED]')
							.replace(/token=[^&]*/g, 'token=[FILTERED]')
					}
				}

				return breadcrumb
			},

			integrations: [
				// TanStack Router integration for navigation tracing + distributed trace header injection
				Sentry.tanstackRouterBrowserTracingIntegration(router),
				Sentry.breadcrumbsIntegration({
					console: false,
				}),
				// Surface non-standard Error properties (e.g. a FetchError's `url`/`status`)
				// as Additional Data. Scrubbed below in scrubSensitiveData via scrubContextValue.
				Sentry.extraErrorDataIntegration(),
			],

			ignoreErrors: [
				'ResizeObserver loop limit exceeded',
				'Non-Error promise rejection captured',
				/extension\//i,
				/^chrome:\/\//i,
				/^moz-extension:\/\//i,
				'Network request failed',
				'Failed to fetch',
				'Failed to fetch access token', // Expected during early renders before auth is ready
				// Benign TanStack DB race (RIPTIDE-UI-AR): when a ShapeStream errors after its
				// collection is already GC'd, @tanstack/electric-db-collection unconditionally calls
				// markReady() on the "cleaned-up" collection, tripping the status-transition guard and
				// surfacing as an unhandled rejection. The collection is already dead — no user impact.
				// Narrowed to this exact transition so genuine bad transitions still report.
				/Invalid collection status transition from "cleaned-up" to "ready"/,
			],
		})

		Sentry.setTag('build_type', buildConfig.type)
		Sentry.setTag('build_channel', buildConfig.channelName)
		Sentry.setTag('platform', 'desktop')
		Sentry.setTag('app_version', buildConfig.version)

		Sentry.setContext('build_info', {
			version: buildConfig.version,
			buildConfig,
		})

		logger.info('Sentry initialized for error reporting')
	} catch (error) {
		logger.error('Failed to initialize Sentry:', error)
	}
}

/**
 * Recursively scrub a value captured into a Sentry context. Used for the
 * per-error data attached by extraErrorDataIntegration (event.contexts.<ErrorName>,
 * e.g. a FetchError's `url`/`status`/`headers`). URL secrets are redacted and
 * sensitively-named fields are dropped — matching is on field *names*, not values,
 * so a sync URL whose path contains "conversation"/"sessions" is preserved rather
 * than mistaken for sensitive content.
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
		if (IDENTIFIER_ALLOWLIST.includes(lower)) {
			scrubbed[key] = scrubContextValue(val, depth + 1)
			continue
		}
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
function scrubSensitiveData<T extends Sentry.Event>(event: T): T {
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

	// Preserve allowed user fields for debugging (email, org info for user identification)
	// Note: Fields set in AuthProvider.tsx Sentry.setUser() - only allowlisted fields are preserved
	if (event.user) {
		const { id, email, organizationId, organizationName, role, roles, featureFlags } = event.user as Record<
			string,
			unknown
		>
		event.user = {
			id: id as string | undefined,
			email: email as string | undefined,
			organizationId: organizationId as string | undefined,
			organizationName: organizationName as string | undefined,
			role: role as string | undefined,
			roles: roles as string | undefined,
			featureFlags: featureFlags as string | undefined,
		}
	}

	// Scrub breadcrumbs for sensitive data
	if (event.breadcrumbs) {
		event.breadcrumbs = event.breadcrumbs
			.filter((breadcrumb) => {
				// Remove any breadcrumb mentioning sensitive operations
				if (breadcrumb.message?.includes('store') || breadcrumb.category?.includes('zustand')) {
					return false
				}
				return true
			})
			.map((breadcrumb) => {
				if (breadcrumb.data) {
					const sanitized = { ...breadcrumb.data }
					// Remove common sensitive fields
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
			// Allow known identifier fields through — they're safe debugging context
			if (IDENTIFIER_ALLOWLIST.includes(key.toLowerCase())) return
			// Remove any key that might contain sensitive data
			if (SENSITIVE_KEYS.some((sensitive) => key.toLowerCase().includes(sensitive))) {
				delete event.extra?.[key]
			}
			// Also check the value if it's an object
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

// Export function for manual error capture
export function captureException(
	error: unknown,
	options?: { extra?: Record<string, unknown>; tags?: Record<string, string> },
) {
	Sentry.captureException(error, {
		extra: options?.extra ? scrubSensitiveData({ extra: options.extra } as Sentry.ErrorEvent).extra : undefined,
		tags: options?.tags,
	})
}

// Export function for manual message capture
export function captureMessage(
	message: string,
	level: Sentry.SeverityLevel = 'info',
	context?: Record<string, unknown>,
) {
	Sentry.captureMessage(message, {
		level,
		extra: context ? scrubSensitiveData({ extra: context } as Sentry.ErrorEvent).extra : undefined,
	})
}
