import { describe, it } from '@effect/vitest'
import { DateTime, Effect, Result } from 'effect'
import * as HttpClientRequest from 'effect/http/HttpClientRequest'
import * as HttpClientResponse from 'effect/http/HttpClientResponse'

import {
	ResendOperationError,
	ResendNotCancelableError,
	ResendRateLimitError,
	ResendTransportError,
} from '../../src/effects/services/resend/resend-errors'
import { decodeResendSuccessResponse } from '../../src/effects/services/resend/resend-http-response-decoding'
import { ResendEmailResponseSchema } from '../../src/effects/services/resend/resend.schema'
import { ResendService } from '../../src/effects/services/resend/resend.service'
import {
	makeResendTestLayer,
	resendResponse,
	resendTextResponse,
	resendTransportFailure,
} from '../fixtures/effect-resend'

describe('ResendService', () => {
	it.effect('encodes immediate emails with authentication and idempotency headers', ({ expect }) => {
		const fixture = makeResendTestLayer({ responses: [resendResponse({ id: 'email_immediate' })] })
		return Effect.gen(function* () {
			const resend = yield* ResendService
			const result = yield* resend.sendPlaintext({
				to: 'member@example.test',
				subject: 'Welcome',
				text: 'Plain text',
				html: '<p>HTML</p>',
				idempotencyKey: 'email/00000000-0000-4000-8000-000000000001',
			})

			expect(result).toEqual({ emailId: 'email_immediate' })
			expect(fixture.requests).toHaveLength(1)
			expect(fixture.requests[0]?.method).toBe('POST')
			expect(fixture.requests[0]?.url).toBe('https://resend.example.test/emails')
			expect(fixture.requests[0]?.headers['authorization']).toBe('Bearer re_test_key')
			expect(fixture.requests[0]?.headers['idempotency-key']).toBe('email/00000000-0000-4000-8000-000000000001')
			expect(fixture.requests[0]?.headers['content-type']).toBe('application/json')
			expect(fixture.requestBody(0)).toEqual({
				from: 'sender@example.test',
				to: 'member@example.test',
				subject: 'Welcome',
				text: 'Plain text',
				html: '<p>HTML</p>',
			})
		}).pipe(Effect.provide(fixture.layer))
	})

	it.live('retries an idempotent email after a Resend rate limit', ({ expect }) => {
		const fixture = makeResendTestLayer({
			responses: [
				resendResponse({ statusCode: 429, name: 'rate_limit_exceeded', message: 'slow down' }, { status: 429 }),
				resendResponse({ id: 'email_retried' }),
			],
		})
		return Effect.gen(function* () {
			const resend = yield* ResendService
			const result = yield* resend.sendPlaintext({
				to: 'member@example.test',
				subject: 'Welcome',
				text: 'Plain text',
				idempotencyKey: 'email/00000000-0000-4000-8000-000000000001',
			})

			expect(result).toEqual({ emailId: 'email_retried' })
			expect(fixture.requests).toHaveLength(2)
			expect(fixture.requests[0]?.headers['idempotency-key']).toBe(
				fixture.requests[1]?.headers['idempotency-key'],
			)
		}).pipe(Effect.provide(fixture.layer))
	})

	it.effect('encodes scheduled emails, contact mutations, and events with Resend wire keys', ({ expect }) => {
		const fixture = makeResendTestLayer({
			responses: [
				resendResponse({ id: 'email_scheduled' }),
				resendResponse({ object: 'contact', id: 'contact_created' }),
				resendResponse({ object: 'contact', id: 'contact_updated' }),
				resendResponse({ object: 'event', event: 'onboarding.started' }),
			],
		})
		return Effect.gen(function* () {
			const resend = yield* ResendService
			const scheduledAt = DateTime.toDateUtc(DateTime.makeUnsafe('2026-08-21T12:00:00.000Z'))
			const scheduled = yield* resend.schedulePlaintext({
				to: 'member@example.test',
				subject: 'Reminder',
				text: 'Reminder text',
				scheduledAt,
				idempotencyKey: 'reminder/00000000-0000-4000-8000-000000000001',
			})
			const created = yield* resend.upsertContact({
				email: 'member@example.test',
				firstName: 'Ada',
				lastName: null,
				properties: { sequence: 'welcome' },
				segments: [{ id: 'segment_product_users' }],
			})
			const updated = yield* resend.patchContactProperties({
				email: 'member@example.test',
				firstName: null,
				properties: { milestone: '1' },
			})
			yield* resend.sendEvent({
				event: 'onboarding.started',
				email: 'member@example.test',
				payload: { organizationId: 'org_123' },
			})

			expect(scheduled).toEqual({ emailId: 'email_scheduled', scheduledAt: scheduledAt.toISOString() })
			expect(created).toEqual({ contactId: 'contact_created' })
			expect(updated).toEqual({ contactId: 'contact_updated' })
			expect(fixture.requestBody(0)).toMatchObject({ scheduled_at: scheduledAt.toISOString() })
			expect(fixture.requestBody(1)).toEqual({
				email: 'member@example.test',
				first_name: 'Ada',
				last_name: null,
				properties: { sequence: 'welcome' },
				segments: [{ id: 'segment_product_users' }],
			})
			expect(fixture.requestBody(2)).toEqual({ first_name: null, properties: { milestone: '1' } })
			expect(fixture.requestBody(3)).toEqual({
				event: 'onboarding.started',
				email: 'member@example.test',
				payload: { organizationId: 'org_123' },
			})
		}).pipe(Effect.provide(fixture.layer))
	})

	it.effect('projects typed contact properties and treats a missing contact as absent', ({ expect }) => {
		const fixture = makeResendTestLayer({
			responses: [
				resendResponse({
					object: 'contact',
					id: 'contact_123',
					email: 'member@example.test',
					first_name: 'Ada',
					last_name: null,
					created_at: '2026-08-21T12:00:00.000Z',
					unsubscribed: false,
					properties: {
						sequence: { type: 'string', value: 'welcome' },
						step: { type: 'number', value: 2 },
					},
				}),
				resendResponse({ statusCode: 404, name: 'not_found', message: 'contact not found' }, { status: 404 }),
			],
		})
		return Effect.gen(function* () {
			const resend = yield* ResendService
			const contact = yield* resend.getContact({ email: 'member@example.test' })
			const missing = yield* resend.getContact({ email: 'missing@example.test' })

			expect(contact).toEqual({
				id: 'contact_123',
				email: 'member@example.test',
				firstName: 'Ada',
				lastName: null,
				unsubscribed: false,
				properties: { sequence: 'welcome', step: '2' },
			})
			expect(missing).toBeNull()
		}).pipe(Effect.provide(fixture.layer))
	})

	it.effect('returns a typed decode error when Resend sends a malformed success payload', ({ expect }) => {
		const fixture = makeResendTestLayer({ responses: [resendResponse({ unexpected: true })] })
		return Effect.gen(function* () {
			const resend = yield* ResendService
			const result = yield* Effect.result(
				resend.sendPlaintext({
					to: 'member@example.test',
					subject: 'Welcome',
					text: 'Plain text',
					idempotencyKey: 'email/00000000-0000-4000-8000-000000000001',
				}),
			)

			expect(Result.isFailure(result)).toBe(true)
			if (Result.isFailure(result)) {
				expect(result.failure).toBeInstanceOf(ResendOperationError)
				if (result.failure instanceof ResendOperationError) {
					expect(result.failure.category).toBe('unexpected_response')
					expect('cause' in result.failure).toBe(false)
				}
			}
		}).pipe(Effect.provide(fixture.layer))
	})

	it.effect('classifies retry-after rate limits and keeps transport errors free of the API key', ({ expect }) => {
		const fixture = makeResendTestLayer({ responses: [resendTransportFailure('network unavailable')] })
		return Effect.gen(function* () {
			const rateLimitResponse = HttpClientResponse.fromWeb(
				HttpClientRequest.get('/emails'),
				new Response(JSON.stringify({ statusCode: 429, name: 'rate_limit_exceeded', message: 'slow down' }), {
					status: 429,
					headers: { 'content-type': 'application/json', 'retry-after': '2' },
				}),
			)
			const rateLimitResult = yield* Effect.result(
				decodeResendSuccessResponse(rateLimitResponse, ResendEmailResponseSchema, 'email.send'),
			)
			expect(Result.isFailure(rateLimitResult)).toBe(true)
			if (Result.isFailure(rateLimitResult)) {
				expect(rateLimitResult.failure).toBeInstanceOf(ResendRateLimitError)
				if (rateLimitResult.failure instanceof ResendRateLimitError) {
					expect(rateLimitResult.failure.retryAfterMs).toBe(2_000)
				}
			}

			const resendHttp = yield* fixture.resendHttpClient
			const result = yield* Effect.result(
				resendHttp.execute(HttpClientRequest.get('/contacts/member@example.test')),
			)
			expect(Result.isFailure(result)).toBe(true)
			if (Result.isFailure(result)) {
				expect(result.failure).toBeInstanceOf(ResendTransportError)
				expect(result.failure.path_template).toBe('/contacts/{identifier}')
				expect(JSON.stringify(result.failure)).not.toContain('re_test_key')
			}
		}).pipe(Effect.provide(fixture.httpLayer))
	})

	it.effect('returns ResendNotCancelableError for a missing scheduled email', ({ expect }) => {
		const fixture = makeResendTestLayer({
			responses: [
				resendTextResponse(JSON.stringify({ statusCode: 404, name: 'not_found', message: 'email not found' }), {
					status: 404,
				}),
			],
		})
		return Effect.gen(function* () {
			const resend = yield* ResendService
			const result = yield* Effect.result(resend.cancelScheduled({ emailId: 'email_missing' }))
			expect(Result.isFailure(result)).toBe(true)
			if (Result.isFailure(result)) expect(result.failure).toBeInstanceOf(ResendNotCancelableError)
			expect(fixture.requests[0]?.headers['content-type']).toBe('application/json')
		}).pipe(Effect.provide(fixture.layer))
	})

	it.effect('does not retry a potentially non-idempotent event after a server failure', ({ expect }) => {
		const fixture = makeResendTestLayer({
			responses: [
				resendResponse(
					{ statusCode: 503, name: 'internal_server_error', message: 'service unavailable' },
					{ status: 503 },
				),
			],
		})
		return Effect.gen(function* () {
			const resend = yield* ResendService
			const result = yield* Effect.result(
				resend.sendEvent({ event: 'onboarding.started', email: 'member@example.test' }),
			)

			expect(Result.isFailure(result)).toBe(true)
			expect(fixture.requests).toHaveLength(1)
		}).pipe(Effect.provide(fixture.layer))
	})
})
