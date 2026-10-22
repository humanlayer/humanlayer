import { Effect } from 'effect'
import * as HttpClientRequest from 'effect/http/HttpClientRequest'
import * as Schema from 'effect/Schema'

import { ResendHttpClient } from '../resend-http-client.service'
import { decodeResendSuccessResponse } from '../resend-http-response-decoding'
import {
	ResendEmailRequestSchema,
	ResendEmailResponseSchema,
	ResendIdempotencyKeySchema,
	type ResendEmailRequestBody,
} from '../resend.schema'

export type SendEmailInput = {
	readonly fromEmail: string
	readonly to: string
	readonly subject: string
	readonly text: string
	readonly html?: string
	readonly scheduledAt?: string
	readonly idempotencyKey: string
}

/** Sends an immediate or scheduled email through Resend's shared `/emails` endpoint. */
export const sendEmail = (input: SendEmailInput) =>
	Effect.gen(function* () {
		const resendHttp = yield* ResendHttpClient
		const idempotencyKey = yield* Schema.decodeUnknownEffect(ResendIdempotencyKeySchema)(input.idempotencyKey).pipe(
			Effect.orDie,
		)
		const requestBody: ResendEmailRequestBody = {
			from: input.fromEmail,
			to: input.to,
			subject: input.subject,
			text: input.text,
		}
		if (input.html !== undefined) requestBody.html = input.html
		if (input.scheduledAt !== undefined) requestBody.scheduledAt = input.scheduledAt
		const request = yield* HttpClientRequest.schemaBodyJson(ResendEmailRequestSchema)(requestBody)(
			HttpClientRequest.post('/emails').pipe(HttpClientRequest.setHeader('Idempotency-Key', idempotencyKey)),
		).pipe(Effect.orDie)
		const response = yield* resendHttp.execute(request)
		const email = yield* decodeResendSuccessResponse(response, ResendEmailResponseSchema, 'email.send')
		return { emailId: email.id }
	}).pipe(Effect.withSpan('resend.send_email'))
