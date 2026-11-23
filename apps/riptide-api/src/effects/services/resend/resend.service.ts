import { Context, type Effect } from 'effect'
import type * as Schema from 'effect/Schema'

import type { ResendError } from './resend-errors'

export type ResendSendPlaintextInput = {
	readonly to: string
	readonly subject: string
	readonly text: string
	readonly html?: string
	readonly idempotencyKey: string
}

export type ResendSchedulePlaintextInput = ResendSendPlaintextInput & {
	readonly scheduledAt: Date
}

export type ResendCancelScheduledInput = {
	readonly emailId: string
}

export type ResendGetContactInput = {
	readonly email: string
}

export type ResendUpsertContactInput = {
	readonly email: string
	readonly firstName?: string | null
	readonly lastName?: string | null
	readonly properties?: Readonly<Record<string, string>>
	readonly unsubscribed?: boolean
	readonly segments?: readonly { readonly id: string }[]
}

export type ResendPatchContactPropertiesInput = {
	readonly email: string
	readonly properties: Readonly<Record<string, string>>
	readonly firstName?: string | null
	readonly lastName?: string | null
	readonly unsubscribed?: boolean
}

export type ResendSendEventInput = {
	readonly event: string
	readonly email: string
	readonly payload?: Readonly<Record<string, Schema.Json>>
}

export type ResendContact = {
	readonly id: string
	readonly email: string
	readonly firstName?: string | null
	readonly lastName?: string | null
	readonly unsubscribed?: boolean
	readonly properties: Readonly<Record<string, string>>
}

export type ResendServiceShape = {
	/**
	 * Whether this deployment can send email (RESEND_API_KEY, RESEND_FROM_EMAIL, and
	 * RESEND_PRODUCT_USERS_SEGMENT_ID all set). When false, the service is a stand-in whose sends
	 * fail with `EmailNotConfiguredError`.
	 */
	readonly configured: boolean
	/** RESEND_FROM_EMAIL when email is set up, otherwise null. Shown to admins in settings. */
	readonly fromAddress: string | null
	readonly sendPlaintext: (
		input: ResendSendPlaintextInput,
	) => Effect.Effect<{ readonly emailId: string }, ResendError>
	readonly schedulePlaintext: (
		input: ResendSchedulePlaintextInput,
	) => Effect.Effect<{ readonly emailId: string; readonly scheduledAt: string }, ResendError>
	readonly cancelScheduled: (input: ResendCancelScheduledInput) => Effect.Effect<void, ResendError>
	readonly getContact: (input: ResendGetContactInput) => Effect.Effect<ResendContact | null, ResendError>
	readonly upsertContact: (
		input: ResendUpsertContactInput,
	) => Effect.Effect<{ readonly contactId: string }, ResendError>
	readonly patchContactProperties: (
		input: ResendPatchContactPropertiesInput,
	) => Effect.Effect<{ readonly contactId: string }, ResendError>
	readonly sendEvent: (input: ResendSendEventInput) => Effect.Effect<void, ResendError>
}

/** Domain email and contact operations backed by Resend. */
export class ResendService extends Context.Service<ResendService, ResendServiceShape>()('ResendService') {}
