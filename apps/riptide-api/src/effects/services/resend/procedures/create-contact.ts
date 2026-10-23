import { Effect } from 'effect'
import * as HttpClientRequest from 'effect/http/HttpClientRequest'

import { ResendHttpClient } from '../resend-http-client.service'
import { decodeResendSuccessResponse } from '../resend-http-response-decoding'
import {
	ResendContactCreateRequestSchema,
	ResendContactResultSchema,
	type ResendContactCreateRequestBody,
} from '../resend.schema'
import type { ResendUpsertContactInput } from '../resend.service'

export const createContact = (input: ResendUpsertContactInput) =>
	Effect.gen(function* () {
		const resendHttp = yield* ResendHttpClient
		const requestBody: ResendContactCreateRequestBody = {
			email: input.email,
		}
		if (input.firstName !== undefined) requestBody.firstName = input.firstName
		if (input.lastName !== undefined) requestBody.lastName = input.lastName
		if (input.unsubscribed !== undefined) requestBody.unsubscribed = input.unsubscribed
		if (input.properties !== undefined) requestBody.properties = input.properties
		if (input.segments !== undefined) requestBody.segments = input.segments
		const request = yield* HttpClientRequest.schemaBodyJson(ResendContactCreateRequestSchema)(requestBody)(
			HttpClientRequest.post('/contacts'),
		).pipe(Effect.orDie)
		const response = yield* resendHttp.execute(request)
		const contact = yield* decodeResendSuccessResponse(response, ResendContactResultSchema, 'contact.create')
		return { contactId: contact.id }
	}).pipe(Effect.withSpan('resend.create_contact'))
