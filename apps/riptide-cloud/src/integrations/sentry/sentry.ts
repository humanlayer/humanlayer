import * as Sentry from '@sentry/react'
import type { AnyRouter } from '@tanstack/react-router'

// Keys that should NEVER be sent to Sentry - contains user content or secrets
// Identical to: apps/riptide-ui/src/integrations/sentry/sentry.ts:8-28
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
]

export function initializeSentry(router: AnyRouter): void {
	if (import.meta.env.DEV) {
		console.info('Sentry initialization skipped (local development)')
		return
	}
	// Builds from source have no DSN, so they report nowhere.
	const dsn = import.meta.env.VITE_PUBLIC_SENTRY_DSN
	if (!dsn) {
		console.info('Sentry initialization skipped (no VITE_PUBLIC_SENTRY_DSN)')
		return
	}
	try {
		Sentry.init({
			dsn,
			environment: import.meta.env.DEV ? 'local' : (import.meta.env.VITE_PUBLIC_SENTRY_ENVIRONMENT ?? 'prod'),
			release: import.meta.env.VITE_PUBLIC_BUILD_VERSION,

			tracesSampleRate: 0.0001,
			replaysSessionSampleRate: 0,
			replaysOnErrorSampleRate: 0,

			// Scrub sensitive data before sending — pattern from sentry.ts:43-45
			beforeSend(event: Sentry.ErrorEvent) {
				return scrubSensitiveData(event)
			},

			// Filter breadcrumbs — pattern from sentry.ts:47-71
			beforeBreadcrumb(breadcrumb) {
				// Never capture console logs
				if (breadcrumb.category === 'console') return null

				// Sanitize HTTP request breadcrumbs
				if (breadcrumb.category === 'fetch' || breadcrumb.category === 'xhr') {
					if (breadcrumb.data?.url) {
						breadcrumb.data.url = breadcrumb.data.url
							.replace(/query=[^&]*/g, 'query=[FILTERED]')
							.replace(/token=[^&]*/g, 'token=[FILTERED]')
					}
				}

				return breadcrumb
			},

			// TanStack Router tracing + breadcrumbs — pattern from sentry.ts:73-79
			integrations: [
				Sentry.tanstackRouterBrowserTracingIntegration(router),
				Sentry.breadcrumbsIntegration({ console: false }),
			],

			// Ignored errors — pattern from sentry.ts:81-89
			ignoreErrors: [
				'ResizeObserver loop limit exceeded',
				'Non-Error promise rejection captured',
				/extension\//i,
				/^chrome:\/\//i,
				/^moz-extension:\/\//i,
				'Network request failed',
				'Failed to fetch',
			],
		})

		// Global tags — pattern from sentry.ts:92-100
		Sentry.setTag('platform', 'cloud')
		Sentry.setTag('app_version', import.meta.env.VITE_PUBLIC_BUILD_VERSION || 'dev')

		console.info('Sentry initialized for error reporting')
	} catch (error) {
		console.error('Failed to initialize Sentry:', error)
	}
}

/**
 * Scrub sensitive data from Sentry events before sending.
 * Identical logic to: apps/riptide-ui/src/integrations/sentry/sentry.ts:112-194
 */
function scrubSensitiveData<T extends Sentry.Event>(event: T): T {
	// Remove state stores completely
	if (event.contexts?.state) delete event.contexts.state

	// Scrub request URLs
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

	// Allowlist user fields — pattern from sentry.ts:137-151
	if (event.user) {
		const { id, email, organizationId, organizationName, role, roles } = event.user as Record<string, unknown>
		event.user = {
			id: id as string | undefined,
			email: email as string | undefined,
			organizationId: organizationId as string | undefined,
			organizationName: organizationName as string | undefined,
			role: role as string | undefined,
			roles: roles as string | undefined,
		}
	}

	// Scrub breadcrumbs — pattern from sentry.ts:154-174
	if (event.breadcrumbs) {
		event.breadcrumbs = event.breadcrumbs
			.filter((breadcrumb) => {
				if (breadcrumb.message?.includes('store') || breadcrumb.category?.includes('zustand')) return false
				return true
			})
			.map((breadcrumb) => {
				if (breadcrumb.data) {
					const sanitized = { ...breadcrumb.data }
					for (const key of SENSITIVE_KEYS) delete sanitized[key]
					breadcrumb.data = sanitized
				}
				return breadcrumb
			})
	}

	// Aggressively scrub extra context — pattern from sentry.ts:177-191
	if (event.extra) {
		for (const key of Object.keys(event.extra)) {
			if (SENSITIVE_KEYS.some((sensitive) => key.toLowerCase().includes(sensitive))) {
				delete event.extra?.[key]
			}
			if (typeof event.extra?.[key] === 'object' && event.extra?.[key] !== null) {
				const str = JSON.stringify(event.extra?.[key])
				if (SENSITIVE_KEYS.some((sensitive) => str.toLowerCase().includes(sensitive))) {
					delete event.extra?.[key]
				}
			}
		}
	}

	return event
}

// Manual capture helpers with automatic scrubbing — pattern from sentry.ts:197-209
export function captureException(error: Error, context?: Record<string, unknown>) {
	Sentry.captureException(error, {
		extra: context ? scrubSensitiveData({ extra: context } as Sentry.ErrorEvent).extra : undefined,
	})
}

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
