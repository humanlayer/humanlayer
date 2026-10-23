import { Effect } from 'effect'
import * as HttpClientRequest from 'effect/http/HttpClientRequest'

import { ResendHttpClient } from '../resend-http-client.service'
import { decodeResendSuccessResponse } from '../resend-http-response-decoding'
import { ResendCanceledEmailResponseSchema } from '../resend.schema'

export const cancelScheduledEmail = (input: { readonly emailId: string }) =>
	Effect.gen(function* () {
		const resendHttp = yield* ResendHttpClient
		const request = HttpClientRequest.post(`/emails/${encodeURIComponent(input.emailId)}/cancel`).pipe(
			HttpClientRequest.setHeader('Content-Type', 'application/json'),
		)
		const response = yield* resendHttp.execute(request)
		yield* decodeResendSuccessResponse(response, ResendCanceledEmailResponseSchema, 'email.cancel')
	}).pipe(Effect.withSpan('resend.cancel_scheduled_email'))
