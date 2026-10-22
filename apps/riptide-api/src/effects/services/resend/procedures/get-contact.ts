import { Effect } from 'effect'
import * as HttpClientRequest from 'effect/http/HttpClientRequest'

import { ResendHttpClient } from '../resend-http-client.service'
import { decodeResendSuccessResponse } from '../resend-http-response-decoding'
import { ResendContactResponseSchema } from '../resend.schema'
import { projectResendContact } from './projection'

export const getContact = (input: { readonly email: string }) =>
	Effect.gen(function* () {
		const resendHttp = yield* ResendHttpClient
		const request = HttpClientRequest.get(`/contacts/${encodeURIComponent(input.email)}`)
		const response = yield* resendHttp.execute(request)
		const contact = yield* decodeResendSuccessResponse(response, ResendContactResponseSchema, 'contact.get')
		return projectResendContact(contact)
	}).pipe(Effect.withSpan('resend.get_contact'))
