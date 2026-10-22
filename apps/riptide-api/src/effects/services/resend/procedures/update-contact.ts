import { Effect } from 'effect'
import * as HttpClientRequest from 'effect/http/HttpClientRequest'

import { ResendHttpClient } from '../resend-http-client.service'
import { decodeResendSuccessResponse } from '../resend-http-response-decoding'
import {
	ResendContactResultSchema,
	ResendContactUpdateRequestSchema,
	type ResendContactUpdateRequestBody,
} from '../resend.schema'
import type { ResendPatchContactPropertiesInput } from '../resend.service'

export const updateContact = (input: ResendPatchContactPropertiesInput) =>
	Effect.gen(function* () {
		const resendHttp = yield* ResendHttpClient
		const requestBody: ResendContactUpdateRequestBody = {
			properties: input.properties,
		}
		if (input.firstName !== undefined) requestBody.firstName = input.firstName
		if (input.lastName !== undefined) requestBody.lastName = input.lastName
		if (input.unsubscribed !== undefined) requestBody.unsubscribed = input.unsubscribed
		const request = yield* HttpClientRequest.schemaBodyJson(ResendContactUpdateRequestSchema)(requestBody)(
			HttpClientRequest.patch(`/contacts/${encodeURIComponent(input.email)}`),
		).pipe(Effect.orDie)
		const response = yield* resendHttp.execute(request)
		const contact = yield* decodeResendSuccessResponse(response, ResendContactResultSchema, 'contact.update')
		return { contactId: contact.id }
	}).pipe(Effect.withSpan('resend.update_contact'))
