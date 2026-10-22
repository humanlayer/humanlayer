import type { Hono } from 'hono'

import { Sentry } from '../instrument'
import { logger as defaultLogger } from '../logger'

type ResendWebhookEvent = {
	type: string
	data?: unknown
}

export type ResendWebhookVerifier = {
	webhooks: {
		verify: (args: {
			payload: string
			headers: {
				id: string
				timestamp: string
				signature: string
			}
			webhookSecret: string
		}) => ResendWebhookEvent | Promise<ResendWebhookEvent>
	}
}

export type ResendWebhookDeps = {
	resend: ResendWebhookVerifier
	webhookSecret: string
	logger?: Pick<typeof defaultLogger, 'info' | 'warn' | 'error'>
	captureException?: typeof Sentry.captureException
}

const deliveryFailureEventTypes = new Set(['email.bounced', 'email.complained', 'email.delivery_delayed'])

const SUPPRESSION_EVENT_TYPE = 'email.suppressed'

// WorkOS stamps its AuthKit emails with a tag identifying the email type. These map to WorkOS's
// four transactional email types: Magic Auth (magic-code), Email verification (email-verification),
// Password reset (password-reset), and Invitation (invitation). This tagging scheme is NOT publicly
// documented by WorkOS — it is derived from observed Resend webhook payloads in production, so treat
// the set as best-effort and keep the secondary `userland` marker below as a backstop.
const WORKOS_AUTH_EMAIL_TAGS = new Set(['magic-code', 'email-verification', 'password-reset', 'invitation'])
// WorkOS also stamps a `userland` tag on AuthKit-originated emails. We use it as a secondary signal so
// that a new/unenumerated WorkOS auth email type is still flagged as auth-related.
const WORKOS_USERLAND_TAG = 'userland'

type SuppressionSummary = {
	recipients: string[]
	subject?: string
	reason?: string
	suppressionType?: string
	tags: Record<string, string>
	authEmailType?: string
	isWorkosAuth: boolean
}

function toRecord(value: unknown): Record<string, unknown> {
	return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function toStringRecord(value: unknown): Record<string, string> {
	const result: Record<string, string> = {}
	for (const [key, val] of Object.entries(toRecord(value))) {
		if (typeof val === 'string') {
			result[key] = val
		}
	}
	return result
}

// Parse the `email.suppressed` payload defensively (event.data is unknown) and derive whether the
// suppressed message was a WorkOS auth email (the login-blocking case we most care about).
export function summarizeResendSuppression(data: unknown): SuppressionSummary {
	const root = toRecord(data)
	const suppressed = toRecord(root.suppressed)
	const tags = toStringRecord(root.tags)

	const recipients = Array.isArray(root.to)
		? root.to.filter((value): value is string => typeof value === 'string')
		: []
	const reason = typeof suppressed.reason === 'string' ? suppressed.reason : undefined
	const suppressionType = typeof suppressed.type === 'string' ? suppressed.type : undefined
	const subject = typeof root.subject === 'string' ? root.subject : undefined

	// WorkOS encodes the type as both the tag key and value (e.g. {"magic-code":"magic-code"}); check
	// both so detection is robust to either shape.
	const tagTokens = [...Object.keys(tags), ...Object.values(tags)]
	const authEmailType = tagTokens.find((token) => WORKOS_AUTH_EMAIL_TAGS.has(token))
	const hasUserlandTag = tagTokens.includes(WORKOS_USERLAND_TAG)

	return {
		recipients,
		subject,
		reason,
		suppressionType,
		tags,
		authEmailType,
		isWorkosAuth: authEmailType !== undefined || hasUserlandTag,
	}
}

export function registerResendWebhookRoute(app: Hono, deps: ResendWebhookDeps): void {
	const routeLogger = deps.logger ?? defaultLogger
	const captureException = deps.captureException ?? Sentry.captureException.bind(Sentry)

	app.post('/webhooks/resend', async (c) => {
		const svixId = c.req.header('svix-id')
		const svixTimestamp = c.req.header('svix-timestamp')
		const svixSignature = c.req.header('svix-signature')

		if (!svixId || !svixTimestamp || !svixSignature) {
			routeLogger.warn('Missing Svix signature headers on Resend webhook request')
			return c.json({ error: 'Missing Resend signature headers' }, 400)
		}

		const payload = await c.req.raw.text()

		let event: ResendWebhookEvent
		try {
			event = await deps.resend.webhooks.verify({
				payload,
				headers: {
					id: svixId,
					timestamp: svixTimestamp,
					signature: svixSignature,
				},
				webhookSecret: deps.webhookSecret,
			})
		} catch (error) {
			routeLogger.error({ err: error }, 'Resend webhook signature verification failed')
			captureException(error)
			return c.json({ error: 'Invalid Resend webhook signature' }, 400)
		}

		if (event.type === SUPPRESSION_EVENT_TYPE) {
			const summary = summarizeResendSuppression(event.data)
			const logFields = {
				eventType: event.type,
				recipients: summary.recipients,
				subject: summary.subject,
				reason: summary.reason,
				suppressionType: summary.suppressionType,
				isWorkosAuth: summary.isWorkosAuth,
				authEmailType: summary.authEmailType,
				tags: summary.tags,
			}

			// A suppressed WorkOS auth email means a user cannot receive their login/verification email,
			// so escalate it as an error; other suppressions (e.g. marketing drips) are warn-level.
			if (summary.isWorkosAuth) {
				routeLogger.error(logFields, 'Resend suppressed WorkOS auth email')
			} else {
				routeLogger.warn(logFields, 'Resend suppressed email')
			}

			const error = new Error(
				summary.isWorkosAuth
					? `Resend suppressed WorkOS auth email${summary.authEmailType ? ` (${summary.authEmailType})` : ''}`
					: 'Resend suppressed email',
			)
			captureException(error, {
				level: summary.isWorkosAuth ? 'error' : 'warning',
				tags: {
					component: 'resend_webhook',
					failure_type: 'suppression',
					event_type: event.type,
					suppression_reason: summary.reason ?? 'unknown',
					suppression_type: summary.suppressionType ?? 'unknown',
					is_workos_auth: summary.isWorkosAuth,
					auth_email_type: summary.authEmailType ?? 'none',
				},
				extra: {
					eventType: event.type,
					recipients: summary.recipients,
					subject: summary.subject,
					tags: summary.tags,
					data: event.data,
				},
				// Group by auth email type (not recipient) so issues stay stable and recipient PII stays
				// out of the fingerprint. `userland`-only auth emails fall back to 'workos-auth'.
				fingerprint: [
					'resend',
					'email.suppressed',
					summary.authEmailType ?? (summary.isWorkosAuth ? 'workos-auth' : 'other'),
				],
			})
		} else if (deliveryFailureEventTypes.has(event.type)) {
			const error = new Error(`Resend delivery failure: ${event.type}`)
			routeLogger.error({ eventType: event.type, data: event.data }, 'Resend delivery failure')
			captureException(error, {
				tags: {
					component: 'resend_webhook',
					failure_type: 'delivery_failure',
					event_type: event.type,
				},
				extra: {
					eventType: event.type,
					data: event.data,
				},
			})
		} else {
			routeLogger.info({ eventType: event.type, data: event.data }, 'Resend webhook received')
		}

		return c.json({ received: true })
	})
}
