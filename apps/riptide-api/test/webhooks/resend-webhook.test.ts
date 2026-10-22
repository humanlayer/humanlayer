import { describe, expect, test } from 'vitest'

import { summarizeResendSuppression, type ResendWebhookDeps } from '../../src/webhooks/resend'
import { createMockStripeService, createMockWorkosService } from '../mocks'
import { createApp } from '../test-factory'

const noopStripeService = createMockStripeService()

function createResendTestApp(input?: { verifyError?: Error }) {
	const verifyCalls: Array<{
		payload: string
		headers: { id: string; timestamp: string; signature: string }
		webhookSecret: string
	}> = []
	const infoLogs: unknown[] = []
	const warnLogs: unknown[] = []
	const errorLogs: unknown[] = []
	const capturedExceptions: unknown[] = []

	const resendWebhook: ResendWebhookDeps = {
		resend: {
			webhooks: {
				verify: ({ payload, headers, webhookSecret }) => {
					verifyCalls.push({ payload, headers, webhookSecret })
					if (input?.verifyError) {
						throw input.verifyError
					}
					return JSON.parse(payload)
				},
			},
		},
		webhookSecret: 'whsec_resend_test',
		logger: {
			info: async (...args: unknown[]) => {
				infoLogs.push(args)
			},
			warn: async (...args: unknown[]) => {
				warnLogs.push(args)
			},
			error: async (...args: unknown[]) => {
				errorLogs.push(args)
			},
		},
		captureException: (...args: unknown[]) => {
			capturedExceptions.push(args)
			return 'event-id'
		},
	}

	const app = createApp({
		db: {} as any,
		workos: createMockWorkosService(),
		stripe: noopStripeService,
		resendWebhook,
	})

	return { app, verifyCalls, infoLogs, warnLogs, errorLogs, capturedExceptions }
}

describe('POST /webhooks/resend', () => {
	function buildEventBody(type = 'email.delivered') {
		return JSON.stringify(
			{
				type,
				data: {
					email_id: 'email_resend_route_test',
					to: ['user@example.com'],
				},
			},
			null,
			2,
		)
	}

	function buildSuppressionBody(input?: { tags?: Record<string, string>; reason?: string; to?: string[] }) {
		return JSON.stringify({
			type: 'email.suppressed',
			data: {
				email_id: 'email_suppressed_test',
				from: 'dex from humanlayer <dex@hey.humanlayer.com>',
				subject: 'Sign up for Humanlayer',
				to: input?.to ?? ['user@example.com'],
				...(input?.tags ? { tags: input.tags } : {}),
				suppressed: {
					reason: input?.reason ?? 'previous_bounce',
					type: 'OnAccountSuppressionList',
					message:
						'Resend has suppressed sending to this address because it is on the account-level suppression list. This does not count toward your bounce rate metric',
					diagnosticCode: [
						'Amazon SES did not send the message to this address because it is on the suppression list',
					],
				},
			},
		})
	}

	const svixHeaders = {
		'svix-id': 'msg_resend_test',
		'svix-timestamp': '1700000000',
		'svix-signature': 'v1,test_signature',
	}

	test('returns 400 when Svix signature headers are missing', async () => {
		const { app, verifyCalls, warnLogs } = createResendTestApp()

		const response = await app.request('/webhooks/resend', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: buildEventBody(),
		})

		expect(response.status).toBe(400)
		expect(await response.json()).toEqual({ error: 'Missing Resend signature headers' })
		expect(verifyCalls).toHaveLength(0)
		expect(warnLogs).toHaveLength(1)
	})

	test('returns 400 for an invalid signature', async () => {
		const { app, verifyCalls, errorLogs, capturedExceptions } = createResendTestApp({
			verifyError: new Error('bad signature'),
		})

		const response = await app.request('/webhooks/resend', {
			method: 'POST',
			headers: { 'content-type': 'application/json', ...svixHeaders },
			body: buildEventBody(),
		})

		expect(response.status).toBe(400)
		expect(await response.json()).toEqual({ error: 'Invalid Resend webhook signature' })
		expect(verifyCalls).toHaveLength(1)
		expect(errorLogs).toHaveLength(1)
		expect(capturedExceptions).toHaveLength(1)
	})

	test('returns 200 and logs informational events at info level', async () => {
		const { app, verifyCalls, infoLogs, errorLogs, capturedExceptions } = createResendTestApp()
		const body = buildEventBody('email.delivered')

		const response = await app.request('/webhooks/resend', {
			method: 'POST',
			headers: { 'content-type': 'application/json', ...svixHeaders },
			body,
		})

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({ received: true })
		expect(verifyCalls).toEqual([
			{
				payload: body,
				headers: { id: 'msg_resend_test', timestamp: '1700000000', signature: 'v1,test_signature' },
				webhookSecret: 'whsec_resend_test',
			},
		])
		expect(infoLogs).toHaveLength(1)
		expect(errorLogs).toHaveLength(0)
		expect(capturedExceptions).toHaveLength(0)
	})

	test('returns 200 and escalates deliverability failure events', async () => {
		const { app, infoLogs, errorLogs, capturedExceptions } = createResendTestApp()

		const response = await app.request('/webhooks/resend', {
			method: 'POST',
			headers: { 'content-type': 'application/json', ...svixHeaders },
			body: buildEventBody('email.bounced'),
		})

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({ received: true })
		expect(infoLogs).toHaveLength(0)
		expect(errorLogs).toHaveLength(1)
		expect(capturedExceptions).toHaveLength(1)
	})

	test('passes the raw request body to signature verification', async () => {
		const { app, verifyCalls } = createResendTestApp()
		const rawBody = buildEventBody('email.opened')
		const reparsedBody = JSON.stringify(JSON.parse(rawBody))

		const response = await app.request('/webhooks/resend', {
			method: 'POST',
			headers: { 'content-type': 'application/json', ...svixHeaders },
			body: reparsedBody,
		})

		expect(response.status).toBe(200)
		expect(verifyCalls).toHaveLength(1)
		expect(verifyCalls[0]?.payload).toBe(reparsedBody)
		expect(verifyCalls[0]?.payload).not.toBe(rawBody)
	})

	test('captures WorkOS auth email suppression to Sentry as an error', async () => {
		const { app, infoLogs, warnLogs, errorLogs, capturedExceptions } = createResendTestApp()

		const response = await app.request('/webhooks/resend', {
			method: 'POST',
			headers: { 'content-type': 'application/json', ...svixHeaders },
			body: buildSuppressionBody({
				tags: { 'magic-code': 'magic-code', userland: 'userland' },
				reason: 'previous_bounce',
			}),
		})

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({ received: true })
		expect(infoLogs).toHaveLength(0)
		expect(warnLogs).toHaveLength(0)
		expect(errorLogs).toHaveLength(1)
		expect(capturedExceptions).toHaveLength(1)

		const [, context] = capturedExceptions[0] as [
			Error,
			{ level: string; tags: Record<string, unknown>; fingerprint: string[] },
		]
		expect(context.level).toBe('error')
		expect(context.tags.failure_type).toBe('suppression')
		expect(context.tags.is_workos_auth).toBe(true)
		expect(context.tags.auth_email_type).toBe('magic-code')
		expect(context.tags.suppression_reason).toBe('previous_bounce')
		expect(context.fingerprint).toEqual(['resend', 'email.suppressed', 'magic-code'])
	})

	test('captures non-auth email suppression to Sentry as a warning', async () => {
		const { app, infoLogs, warnLogs, errorLogs, capturedExceptions } = createResendTestApp()

		const response = await app.request('/webhooks/resend', {
			method: 'POST',
			headers: { 'content-type': 'application/json', ...svixHeaders },
			body: buildSuppressionBody({ reason: 'previous_bounce' }),
		})

		expect(response.status).toBe(200)
		expect(infoLogs).toHaveLength(0)
		expect(warnLogs).toHaveLength(1)
		expect(errorLogs).toHaveLength(0)
		expect(capturedExceptions).toHaveLength(1)

		const [, context] = capturedExceptions[0] as [
			Error,
			{ level: string; tags: Record<string, unknown>; fingerprint: string[] },
		]
		expect(context.level).toBe('warning')
		expect(context.tags.is_workos_auth).toBe(false)
		expect(context.tags.auth_email_type).toBe('none')
		expect(context.fingerprint).toEqual(['resend', 'email.suppressed', 'other'])
	})
})

describe('summarizeResendSuppression', () => {
	test('flags WorkOS auth emails from a known type tag', () => {
		const summary = summarizeResendSuppression({
			to: ['user@example.com'],
			subject: 'Verify your email address',
			tags: { 'email-verification': 'email-verification', userland: 'userland' },
			suppressed: { reason: 'previous_complaint', type: 'OnAccountSuppressionList' },
		})

		expect(summary.isWorkosAuth).toBe(true)
		expect(summary.authEmailType).toBe('email-verification')
		expect(summary.reason).toBe('previous_complaint')
		expect(summary.suppressionType).toBe('OnAccountSuppressionList')
		expect(summary.recipients).toEqual(['user@example.com'])
	})

	test('flags userland-only emails as auth even without a known type tag', () => {
		const summary = summarizeResendSuppression({ to: ['u@example.com'], tags: { userland: 'userland' } })

		expect(summary.isWorkosAuth).toBe(true)
		expect(summary.authEmailType).toBeUndefined()
	})

	test('does not flag untagged (marketing/drip) emails as auth', () => {
		const summary = summarizeResendSuppression({ to: ['u@example.com'], subject: 'getting started' })

		expect(summary.isWorkosAuth).toBe(false)
		expect(summary.authEmailType).toBeUndefined()
		expect(summary.tags).toEqual({})
	})

	test('tolerates malformed payloads', () => {
		expect(summarizeResendSuppression(undefined)).toEqual({
			recipients: [],
			subject: undefined,
			reason: undefined,
			suppressionType: undefined,
			tags: {},
			authEmailType: undefined,
			isWorkosAuth: false,
		})
	})
})
