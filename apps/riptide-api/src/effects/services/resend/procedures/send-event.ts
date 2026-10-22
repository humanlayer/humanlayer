import { Effect } from 'effect'
import * as HttpClientRequest from 'effect/http/HttpClientRequest'

import { ResendHttpClient } from '../resend-http-client.service'
import { decodeResendSuccessResponse } from '../resend-http-response-decoding'
import { ResendEventRequestSchema, ResendEventResponseSchema, type ResendEventRequestBody } from '../resend.schema'
import type { ResendSendEventInput } from '../resend.service'

export const sendEvent = (input: ResendSendEventInput) =>
	Effect.gen(function* () {
		const resendHttp = yield* ResendHttpClient
		const requestBody: ResendEventRequestBody = {
			event: input.event,
			email: input.email,
		}
		if (input.payload !== undefined) requestBody.payload = input.payload
		const request = yield* HttpClientRequest.schemaBodyJson(ResendEventRequestSchema)(requestBody)(
			HttpClientRequest.post('/events/send'),
		).pipe(Effect.orDie)
		const response = yield* resendHttp.execute(request)
		yield* decodeResendSuccessResponse(response, ResendEventResponseSchema, 'event.send')
	}).pipe(Effect.withSpan('resend.send_event'))
