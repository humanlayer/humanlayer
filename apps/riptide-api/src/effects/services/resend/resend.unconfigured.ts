import { Effect } from 'effect'

import { EmailNotConfiguredError } from './resend-errors'
import type { ResendServiceShape } from './resend.service'

const failEmailNotConfigured = (operation: string) =>
	Effect.fail(new EmailNotConfiguredError({ operation })).pipe(
		Effect.withSpan(`resend_service.${operation}`, { attributes: { email_configured: false } }),
	)

/**
 * The Resend service for a deployment that cannot send email. Sends and contact writes fail with
 * `EmailNotConfiguredError`. Cancelling a scheduled email succeeds, since nothing could have been
 * scheduled.
 */
export const unconfiguredResendService: ResendServiceShape = {
	configured: false,
	fromAddress: null,
	sendPlaintext: () => failEmailNotConfigured('send_plaintext'),
	schedulePlaintext: () => failEmailNotConfigured('schedule_plaintext'),
	cancelScheduled: () => Effect.void,
	getContact: () => failEmailNotConfigured('get_contact'),
	upsertContact: () => failEmailNotConfigured('upsert_contact'),
	patchContactProperties: () => failEmailNotConfigured('patch_contact_properties'),
	sendEvent: () => failEmailNotConfigured('send_event'),
}
