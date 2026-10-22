import { Duration, Effect, Layer, Predicate, Schedule } from 'effect'
import * as FetchHttpClient from 'effect/http/FetchHttpClient'

import { cancelScheduledEmail } from './procedures/cancel-scheduled-email'
import { createContact } from './procedures/create-contact'
import { getContact } from './procedures/get-contact'
import { sendEmail } from './procedures/send-email'
import { sendEvent } from './procedures/send-event'
import { updateContact } from './procedures/update-contact'
import { ResendConfig } from './resend-config.service'
import { narrowProviderErrors, observeResendErrors } from './resend-error-handling'
import { ResendNotCancelableError } from './resend-errors'
import type { ResendProviderError } from './resend-errors'
import { ResendHttpClientLive } from './resend-http-client.layer'
import { ResendHttpClient } from './resend-http-client.service'
import type { ResendHttpClientShape } from './resend-http-client.service'
import { ResendService } from './resend.service'
import type {
	ResendCancelScheduledInput,
	ResendGetContactInput,
	ResendPatchContactPropertiesInput,
	ResendSchedulePlaintextInput,
	ResendSendEventInput,
	ResendSendPlaintextInput,
	ResendServiceShape,
	ResendUpsertContactInput,
} from './resend.service'

const resendRetrySchedule = Schedule.exponential(Duration.millis(250)).pipe(
	Schedule.setInputType<ResendProviderError>(),
	Schedule.jittered,
	Schedule.upTo({ times: 3 }),
	Schedule.passthrough,
	Schedule.modifyDelay(({ input, duration }) =>
		Effect.succeed(
			input.retryAfterMs === undefined ? duration : Duration.max(duration, Duration.millis(input.retryAfterMs)),
		),
	),
)

const retryIdempotentResendOperation = <A>(effect: Effect.Effect<A, ResendProviderError>) =>
	Effect.retry(effect, { schedule: resendRetrySchedule, while: (error) => error.retryable })

const retryResendEventRateLimit = <A>(effect: Effect.Effect<A, ResendProviderError>) =>
	Effect.retry(effect, { schedule: resendRetrySchedule, while: Predicate.isTagged('ResendRateLimitError') })

const sendPlaintext = (http: ResendHttpClientShape, fromEmail: string, input: ResendSendPlaintextInput) =>
	sendEmail({ ...input, fromEmail }).pipe(
		Effect.provideService(ResendHttpClient, http),
		retryIdempotentResendOperation,
		observeResendErrors('send_plaintext', {}),
		narrowProviderErrors('send_plaintext'),
		Effect.withSpan('resend_service.send_plaintext'),
	)

const schedulePlaintext = (http: ResendHttpClientShape, fromEmail: string, input: ResendSchedulePlaintextInput) =>
	sendEmail({ ...input, fromEmail, scheduledAt: input.scheduledAt.toISOString() }).pipe(
		Effect.provideService(ResendHttpClient, http),
		retryIdempotentResendOperation,
		observeResendErrors('schedule_plaintext', {}),
		narrowProviderErrors('schedule_plaintext'),
		Effect.map((result) => ({ ...result, scheduledAt: input.scheduledAt.toISOString() })),
		Effect.withSpan('resend_service.schedule_plaintext'),
	)

const cancelScheduled = (http: ResendHttpClientShape, input: ResendCancelScheduledInput) =>
	cancelScheduledEmail(input).pipe(
		Effect.provideService(ResendHttpClient, http),
		retryIdempotentResendOperation,
		Effect.catchTag('ResendResourceMissingError', (cause) =>
			Effect.logWarning('Scheduled Resend email was not cancelable').pipe(
				Effect.annotateLogs({ email_id: input.emailId }),
				Effect.andThen(Effect.fail(new ResendNotCancelableError({ emailId: input.emailId, cause }))),
			),
		),
		observeResendErrors('cancel_scheduled', { email_id: input.emailId }),
		narrowProviderErrors('cancel_scheduled'),
		Effect.asVoid,
		Effect.withSpan('resend_service.cancel_scheduled'),
	)

const getResendContact = (http: ResendHttpClientShape, input: ResendGetContactInput) =>
	getContact(input).pipe(
		Effect.provideService(ResendHttpClient, http),
		retryIdempotentResendOperation,
		Effect.catchTag('ResendResourceMissingError', () => Effect.succeed(null)),
		observeResendErrors('get_contact', {}),
		narrowProviderErrors('get_contact'),
		Effect.withSpan('resend_service.get_contact'),
	)

const upsertResendContact = (http: ResendHttpClientShape, input: ResendUpsertContactInput) =>
	createContact(input).pipe(
		Effect.provideService(ResendHttpClient, http),
		observeResendErrors('upsert_contact', {}),
		narrowProviderErrors('upsert_contact'),
		Effect.withSpan('resend_service.upsert_contact'),
	)

const patchResendContactProperties = (http: ResendHttpClientShape, input: ResendPatchContactPropertiesInput) =>
	updateContact(input).pipe(
		Effect.provideService(ResendHttpClient, http),
		retryIdempotentResendOperation,
		observeResendErrors('patch_contact_properties', {}),
		narrowProviderErrors('patch_contact_properties'),
		Effect.withSpan('resend_service.patch_contact_properties'),
	)

const sendResendEvent = (http: ResendHttpClientShape, input: ResendSendEventInput) =>
	sendEvent(input).pipe(
		Effect.provideService(ResendHttpClient, http),
		retryResendEventRateLimit,
		observeResendErrors('send_event', { event_name: input.event }),
		narrowProviderErrors('send_event'),
		Effect.withSpan('resend_service.send_event'),
	)

export const ResendServiceLive = Layer.effect(
	ResendService,
	Effect.gen(function* () {
		const config = yield* ResendConfig
		const http = yield* ResendHttpClient
		const service: ResendServiceShape = {
			sendPlaintext: (input) => sendPlaintext(http, config.fromEmail, input),
			schedulePlaintext: (input) => schedulePlaintext(http, config.fromEmail, input),
			cancelScheduled: (input) => cancelScheduled(http, input),
			getContact: (input) => getResendContact(http, input),
			upsertContact: (input) => upsertResendContact(http, input),
			patchContactProperties: (input) => patchResendContactProperties(http, input),
			sendEvent: (input) => sendResendEvent(http, input),
		}
		return service
	}),
)

const ResendHttpClientWithFetchLive = ResendHttpClientLive.pipe(Layer.provide(FetchHttpClient.layer))

export const ResendServiceWithFetchHttpClientLive = ResendServiceLive.pipe(
	Layer.provideMerge(ResendHttpClientWithFetchLive),
)
