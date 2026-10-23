import { describe, it } from '@effect/vitest'
import { DateTime, Duration, Effect, Layer } from 'effect'

import { ResendConfigLive } from '../../src/effects/services/resend/resend-config.service'
import { ResendServiceWithFetchHttpClientLive } from '../../src/effects/services/resend/resend-service-live'
import { ResendService } from '../../src/effects/services/resend/resend.service'

const requireEnvironmentVariable = (name: string): string => {
	const value = process.env[name]
	if (!value) throw new Error(`Set ${name} before running the live Resend test`)
	return value
}

const requireLiveTestConfiguration = () => {
	if (process.env.RUN_RESEND_LIVE_TESTS !== 'true') {
		throw new Error('Set RUN_RESEND_LIVE_TESTS=true before running the live Resend test')
	}

	if (process.env.RESEND_API_BASE_URL && process.env.RESEND_API_BASE_URL !== 'https://api.resend.com') {
		throw new Error(
			'Unset RESEND_API_BASE_URL or set it to https://api.resend.com before running the live Resend test',
		)
	}

	return {
		recipient: requireEnvironmentVariable('RESEND_LIVE_TEST_RECIPIENT'),
		contactEmail: requireEnvironmentVariable('RESEND_LIVE_TEST_CONTACT_EMAIL'),
		event: requireEnvironmentVariable('RESEND_LIVE_TEST_EVENT'),
	}
}

describe('ResendService live', () => {
	it.live('sends an email through the real Resend HTTP adapter', ({ expect }) =>
		Effect.sync(requireLiveTestConfiguration).pipe(
			Effect.flatMap(({ recipient }) =>
				Effect.gen(function* () {
					const resend = yield* ResendService
					const result = yield* resend.sendPlaintext({
						to: recipient,
						subject: 'Riptide Resend live smoke test',
						text: 'This confirms that the Effect HTTP Resend adapter can send a real email.',
						idempotencyKey: `riptide-resend-live-smoke/${crypto.randomUUID()}`,
					})

					expect(result.emailId).toMatch(/\S/)
				}),
			),
			Effect.provide(ResendServiceWithFetchHttpClientLive.pipe(Layer.provide(ResendConfigLive))),
		),
	)

	it.live('schedules and cancels an email through the real Resend HTTP adapter', ({ expect }) =>
		Effect.sync(requireLiveTestConfiguration).pipe(
			Effect.flatMap(({ recipient }) =>
				Effect.gen(function* () {
					const resend = yield* ResendService
					const scheduledAt = DateTime.toDateUtc(DateTime.addDuration(yield* DateTime.now, '5 minutes'))
					const scheduled = yield* resend.schedulePlaintext({
						to: recipient,
						subject: 'Riptide Resend scheduled-email live test',
						text: 'This scheduled email should be cancelled by the live test.',
						scheduledAt,
						idempotencyKey: `riptide-resend-live-schedule/${crypto.randomUUID()}`,
					})

					expect(scheduled.emailId).toMatch(/\S/)
					expect(scheduled.scheduledAt).toBe(scheduledAt.toISOString())
					yield* Effect.sleep(Duration.seconds(5))
					yield* resend.cancelScheduled({ emailId: scheduled.emailId })
				}),
			),
			Effect.provide(ResendServiceWithFetchHttpClientLive.pipe(Layer.provide(ResendConfigLive))),
		),
	)

	it.live('upserts, retrieves, and updates a contact through the real Resend HTTP adapter', ({ expect }) =>
		Effect.sync(requireLiveTestConfiguration).pipe(
			Effect.flatMap(({ contactEmail }) =>
				Effect.gen(function* () {
					const resend = yield* ResendService
					const existing = yield* resend.getContact({ email: contactEmail })
					const disabled = existing?.properties.onboarding__disabled ?? '0'
					const upserted = yield* resend.upsertContact({
						email: contactEmail,
						properties: { onboarding__disabled: disabled },
					})
					const contactId = upserted.contactId

					expect(contactId).toMatch(/\S/)
					const updated = yield* resend.patchContactProperties({
						email: contactEmail,
						properties: { onboarding__disabled: disabled },
					})
					expect(updated.contactId).toBe(contactId)

					const contact = yield* resend.getContact({ email: contactEmail })
					if (contact === null) return yield* Effect.die('Resend did not return the live-test contact')
					expect(contact.email).toBe(contactEmail)
					expect(contact.properties.onboarding__disabled).toBe(disabled)
				}),
			),
			Effect.provide(ResendServiceWithFetchHttpClientLive.pipe(Layer.provide(ResendConfigLive))),
		),
	)

	it.live('sends a configured harmless event through the real Resend HTTP adapter', ({ expect }) =>
		Effect.sync(requireLiveTestConfiguration).pipe(
			Effect.flatMap(({ contactEmail, event }) =>
				Effect.gen(function* () {
					const resend = yield* ResendService
					const result = yield* resend.sendEvent({
						event,
						email: contactEmail,
						payload: { source: 'riptide_resend_live_test', testRunId: crypto.randomUUID() },
					})

					expect(result).toBeUndefined()
				}),
			),
			Effect.provide(ResendServiceWithFetchHttpClientLive.pipe(Layer.provide(ResendConfigLive))),
		),
	)
})
