import { describe, it } from '@effect/vitest'
import { BillingKvService } from '@humanlayer/billing/billing-kv'
import { RedisService } from '@humanlayer/billing/redis'
import { Cause, ConfigProvider, Effect, Exit, Layer } from 'effect'
import * as HttpClient from 'effect/http/HttpClient'

import { db } from '../../src/db/db'
import { notifyAdmin } from '../../src/effects/services/access-request/access-request-notify'
import { BillingCheckoutCompletionServiceForDeploymentLive } from '../../src/effects/services/billing-checkout-completion/billing-checkout-completion.live'
import { BillingCheckoutCompletionService } from '../../src/effects/services/billing-checkout-completion/billing-checkout-completion.service'
import { OnboardingService, OnboardingServiceLive } from '../../src/effects/services/onboarding/onboarding.service'
import { PostgresDbLive } from '../../src/effects/services/postgres/postgres-db.service'
import { ResendServiceWithFetchHttpClientLive } from '../../src/effects/services/resend/resend-service-live'
import { ResendService } from '../../src/effects/services/resend/resend.service'
import { unconfiguredResendService } from '../../src/effects/services/resend/resend.unconfigured'
import { S3 } from '../../src/effects/services/s3/s3.service'
import { SlackService, SlackServiceLiveBase } from '../../src/effects/services/slack/slack.service'
import { StripeHttpClient } from '../../src/effects/services/stripe/stripe-http-client.service'
import { StripeServiceForDeploymentLive } from '../../src/effects/services/stripe/stripe-service-live'
import { StripeService } from '../../src/effects/services/stripe/stripe.service'
import { WorkosService } from '../../src/effects/services/workos/workos.service'
import { isBillingEnforcementEnabled, parseBillingEnforcementFlag } from '../../src/lib/environment'
import {
	classifyIntegrationKeyGroup,
	describeUnconfiguredIntegrationKeyGroup,
	SlackKeyGroup,
} from '../../src/lib/integration-key-groups'
import { optionalEnvironmentGroup } from '../../src/lib/optional-environment-group'
import { makeCapturedEffectLogs } from '../utils/captured-effect-logs'

const configLayer = (configuration: Record<string, unknown>) =>
	ConfigProvider.layer(ConfigProvider.fromUnknown(configuration))

const httpMustNotBeCalled = Layer.succeed(
	HttpClient.HttpClient,
	HttpClient.make(() => Effect.die('loading integration configuration must not make an HTTP request')),
)

/**
 * What stand-in methods declare in R. Each one dies if used: a stand-in never touches them.
 */
const dependenciesStandInsMustNotUse = Layer.mergeAll(
	PostgresDbLive(db),
	httpMustNotBeCalled,
	Layer.mock(S3, {}),
	Layer.mock(BillingKvService, {}),
	Layer.mock(RedisService, {}),
	Layer.mock(StripeHttpClient, {}),
)

const ORIGINS = { APP_ORIGIN: 'https://app.example.test', CLOUD_ORIGIN: 'https://cloud.example.test' }

const SLACK_KEYS = {
	SLACK_CLIENT_ID: 'slack-client-id',
	SLACK_CLIENT_SECRET: 'slack-client-secret',
	SLACK_APP_ID: 'A123',
	SLACK_SIGNING_SECRET: 'slack-signing-secret',
}

const EMAIL_KEYS = {
	RESEND_API_KEY: 're_test_key',
	RESEND_FROM_EMAIL: 'sender@example.test',
	RESEND_PRODUCT_USERS_SEGMENT_ID: 'segment-test',
}

const STRIPE_KEYS = {
	STRIPE_SECRET_KEY: 'sk_test_key',
	STRIPE_WEBHOOK_SECRET: 'whsec_test',
	STRIPE_PRICE_PRO: 'price_pro',
	STRIPE_PRICE_STARTER: 'price_starter',
}

describe('integration key groups', () => {
	it('names every missing key when only some are set', ({ expect }) => {
		const status = classifyIntegrationKeyGroup(SlackKeyGroup, (key) => key === 'SLACK_CLIENT_ID')
		expect(status).toEqual({
			configured: false,
			missingKeys: ['SLACK_CLIENT_SECRET', 'SLACK_APP_ID', 'SLACK_SIGNING_SECRET'],
			partiallySet: true,
		})
		if (!status.configured) {
			expect(describeUnconfiguredIntegrationKeyGroup(SlackKeyGroup, status)).toBe(
				'Slack is not set up: missing SLACK_CLIENT_SECRET, SLACK_APP_ID, SLACK_SIGNING_SECRET',
			)
		}
	})

	it('names the key prefix when none are set', ({ expect }) => {
		const status = classifyIntegrationKeyGroup(SlackKeyGroup, () => false)
		expect(status.configured).toBe(false)
		if (!status.configured) {
			expect(describeUnconfiguredIntegrationKeyGroup(SlackKeyGroup, status)).toBe(
				'Slack is not set up: no SLACK_* keys are set',
			)
		}
	})

	it('optionalEnvironmentGroup returns every value or null, treating blank values as missing', ({ expect }) => {
		const lines: Array<{ level: string; message: unknown }> = []
		const logger = {
			info: (_fields: unknown, message: unknown) => lines.push({ level: 'info', message }),
			warn: (_fields: unknown, message: unknown) => lines.push({ level: 'warn', message }),
		}
		expect(
			optionalEnvironmentGroup('Jira', ['JIRA_CLIENT_ID', 'JIRA_CLIENT_SECRET'], {
				environment: { JIRA_CLIENT_ID: 'id', JIRA_CLIENT_SECRET: 'secret' },
				logger,
			}),
		).toEqual({ JIRA_CLIENT_ID: 'id', JIRA_CLIENT_SECRET: 'secret' })
		expect(
			optionalEnvironmentGroup('Jira', ['JIRA_CLIENT_ID', 'JIRA_CLIENT_SECRET'], {
				environment: { JIRA_CLIENT_ID: 'id', JIRA_CLIENT_SECRET: '  ' },
				logger,
			}),
		).toBeNull()
		expect(
			optionalEnvironmentGroup('Jira', ['JIRA_CLIENT_ID', 'JIRA_CLIENT_SECRET'], { environment: {}, logger }),
		).toBeNull()
		expect(lines).toEqual([
			{ level: 'warn', message: 'Jira is not set up: missing JIRA_CLIENT_SECRET' },
			{ level: 'info', message: 'Jira is not set up: no JIRA_* keys are set' },
		])
	})
})

describe('IS_BILLING_ENFORCEMENT_ENABLED', () => {
	it('is off when unset, and only the exact string true turns it on', ({ expect }) => {
		expect(parseBillingEnforcementFlag(undefined)).toBe(false)
		expect(parseBillingEnforcementFlag('')).toBe(false)
		expect(parseBillingEnforcementFlag('TRUE')).toBe(false)
		expect(parseBillingEnforcementFlag('1')).toBe(false)
		expect(parseBillingEnforcementFlag('true')).toBe(true)
	})

	it('does not throw on a request when the variable is unset', ({ expect }) => {
		const previous = process.env.IS_BILLING_ENFORCEMENT_ENABLED
		delete process.env.IS_BILLING_ENFORCEMENT_ENABLED
		try {
			expect(isBillingEnforcementEnabled()).toBe(false)
		} finally {
			if (previous === undefined) delete process.env.IS_BILLING_ENFORCEMENT_ENABLED
			else process.env.IS_BILLING_ENFORCEMENT_ENABLED = previous
		}
	})
})

describe('SlackService configuration', () => {
	const loadSlack = (configuration: Record<string, unknown>) => {
		const captured = makeCapturedEffectLogs()
		return SlackService.pipe(
			Effect.provide(
				SlackServiceLiveBase.pipe(
					Layer.provide(Layer.mergeAll(configLayer(configuration), httpMustNotBeCalled)),
				),
			),
			Effect.provide(captured.layer),
			Effect.map((slack) => ({ slack, logs: captured.logs })),
		)
	}

	it.effect('runs the real service when every Slack key is set', ({ expect }) =>
		Effect.gen(function* () {
			const { slack } = yield* loadSlack({ ...SLACK_KEYS, ...ORIGINS })
			expect(slack.configured).toBe(true)
		}),
	)

	it.effect('starts the stand-in and says so when no Slack key is set', ({ expect }) =>
		Effect.gen(function* () {
			const { slack, logs } = yield* loadSlack({ ...ORIGINS })
			expect(slack.configured).toBe(false)
			expect(logs).toContainEqual({ level: 'Info', message: 'Slack is not set up: no SLACK_* keys are set' })

			expect(
				yield* slack
					.getStatus({ organizationId: 'org-1' })
					.pipe(Effect.provide(dependenciesStandInsMustNotUse)),
			).toEqual({
				connected: false,
				enabled: false,
				needsReauth: false,
			})
			const installFailure = yield* slack
				.createInstallUrl({ organizationId: 'org-1', requestedByUserId: 'user-1' })
				.pipe(Effect.flip, Effect.provide(dependenciesStandInsMustNotUse))
			expect(installFailure).toMatchObject({ _tag: 'SlackIntegrationNotConfiguredError' })
		}),
	)

	it.effect('starts the stand-in and warns naming the missing keys when some are set', ({ expect }) =>
		Effect.gen(function* () {
			// No APP_ORIGIN either: the stand-in does not read it.
			const { slack, logs } = yield* loadSlack({
				SLACK_CLIENT_ID: SLACK_KEYS.SLACK_CLIENT_ID,
				SLACK_CLIENT_SECRET: SLACK_KEYS.SLACK_CLIENT_SECRET,
			})
			expect(slack.configured).toBe(false)
			expect(logs).toContainEqual({
				level: 'Warn',
				message: 'Slack is not set up: missing SLACK_APP_ID, SLACK_SIGNING_SECRET',
			})
		}),
	)
})

describe('ResendService configuration', () => {
	const loadResend = (configuration: Record<string, unknown>) => {
		const captured = makeCapturedEffectLogs()
		return ResendService.pipe(
			Effect.provide(ResendServiceWithFetchHttpClientLive.pipe(Layer.provide(configLayer(configuration)))),
			Effect.provide(captured.layer),
			Effect.map((resend) => ({ resend, logs: captured.logs })),
		)
	}

	it.effect('runs the real service when every email key is set', ({ expect }) =>
		Effect.gen(function* () {
			const { resend } = yield* loadResend(EMAIL_KEYS)
			expect(resend.configured).toBe(true)
		}),
	)

	it.effect('starts the stand-in when no email key is set; sends fail and cancels succeed', ({ expect }) =>
		Effect.gen(function* () {
			const { resend, logs } = yield* loadResend({})
			expect(resend.configured).toBe(false)
			expect(logs).toContainEqual({ level: 'Info', message: 'Email is not set up: no RESEND_* keys are set' })

			const sendFailure = yield* resend
				.sendPlaintext({ to: 'a@example.test', subject: 's', text: 't', idempotencyKey: 'k' })
				.pipe(Effect.flip)
			expect(sendFailure).toMatchObject({ _tag: 'EmailNotConfiguredError' })
			yield* resend.cancelScheduled({ emailId: 'email-1' })
		}),
	)

	it.effect('starts the stand-in and warns when the segment ID is missing', ({ expect }) =>
		Effect.gen(function* () {
			const { resend, logs } = yield* loadResend({
				RESEND_API_KEY: EMAIL_KEYS.RESEND_API_KEY,
				RESEND_FROM_EMAIL: EMAIL_KEYS.RESEND_FROM_EMAIL,
			})
			expect(resend.configured).toBe(false)
			expect(logs).toContainEqual({
				level: 'Warn',
				message: 'Email is not set up: missing RESEND_PRODUCT_USERS_SEGMENT_ID',
			})
		}),
	)
})

describe('StripeService at startup', () => {
	const loadStripe = (configuration: Record<string, unknown>) => {
		const captured = makeCapturedEffectLogs()
		return StripeService.pipe(
			Effect.provide(StripeServiceForDeploymentLive.pipe(Layer.provide(configLayer(configuration)))),
			Effect.provide(captured.layer),
			Effect.map((stripe) => ({ stripe, logs: captured.logs })),
		)
	}

	it.effect('billing on, every key set: real Stripe', ({ expect }) =>
		Effect.gen(function* () {
			const { stripe, logs } = yield* loadStripe({ ...STRIPE_KEYS, IS_BILLING_ENFORCEMENT_ENABLED: 'true' })
			expect(stripe.configured).toBe(true)
			expect(logs).toContainEqual({ level: 'Info', message: 'Billing enforcement is on' })
		}),
	)

	it.effect('billing on, a key missing: startup fails naming the key', ({ expect }) =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(
				loadStripe({
					STRIPE_SECRET_KEY: STRIPE_KEYS.STRIPE_SECRET_KEY,
					STRIPE_WEBHOOK_SECRET: STRIPE_KEYS.STRIPE_WEBHOOK_SECRET,
					STRIPE_PRICE_STARTER: STRIPE_KEYS.STRIPE_PRICE_STARTER,
					IS_BILLING_ENFORCEMENT_ENABLED: 'true',
				}),
			)
			expect(Exit.isFailure(exit)).toBe(true)
			if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain('STRIPE_PRICE_PRO')
		}),
	)

	it.effect('billing off, every key set: real Stripe (beta)', ({ expect }) =>
		Effect.gen(function* () {
			const { stripe, logs } = yield* loadStripe({ ...STRIPE_KEYS, IS_BILLING_ENFORCEMENT_ENABLED: 'false' })
			expect(stripe.configured).toBe(true)
			expect(logs).toContainEqual({ level: 'Info', message: 'Billing enforcement is off' })
		}),
	)

	it.effect('billing off, no key set: the stand-in', ({ expect }) =>
		Effect.gen(function* () {
			const { stripe, logs } = yield* loadStripe({ IS_BILLING_ENFORCEMENT_ENABLED: 'false' })
			expect(stripe.configured).toBe(false)
			expect(logs).toContainEqual({ level: 'Info', message: 'Stripe is not set up: no STRIPE_* keys are set' })
			const failure = yield* stripe
				.syncCustomerBillingToKv({ customerId: 'cus_1' })
				.pipe(Effect.flip, Effect.provide(dependenciesStandInsMustNotUse))
			expect(failure).toMatchObject({ _tag: 'BillingNotConfiguredError' })
		}),
	)

	it.effect('billing flag unset, some keys set: off, so the stand-in with a warning', ({ expect }) =>
		Effect.gen(function* () {
			const { stripe, logs } = yield* loadStripe({ STRIPE_SECRET_KEY: STRIPE_KEYS.STRIPE_SECRET_KEY })
			expect(stripe.configured).toBe(false)
			expect(logs).toContainEqual({ level: 'Info', message: 'Billing enforcement is off' })
			expect(logs).toContainEqual({
				level: 'Warn',
				message: 'Stripe is not set up: missing STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_PRO, STRIPE_PRICE_STARTER',
			})
		}),
	)

	it.effect('billing flag unset, every key set: real Stripe', ({ expect }) =>
		Effect.gen(function* () {
			const { stripe } = yield* loadStripe(STRIPE_KEYS)
			expect(stripe.configured).toBe(true)
		}),
	)
})

describe('BillingCheckoutCompletionService without Stripe', () => {
	it.effect('redirects to checkout_unavailable without reading STRIPE_PRICE_*', ({ expect }) =>
		Effect.gen(function* () {
			const completion = yield* BillingCheckoutCompletionService
			const redirect = yield* completion
				.resyncFromCheckoutRedirect({
					url: 'https://api.example.test/billing/checkout/resync?client=native&session_id=cs_1',
				})
				.pipe(
					Effect.provide(
						Layer.mergeAll(
							dependenciesStandInsMustNotUse,
							Layer.mock(StripeService, { configured: false }),
						),
					),
				)
			expect(redirect).toEqual({
				redirectUrl: 'https://app.example.test/billing/return?billing_error=checkout_unavailable',
			})
		}).pipe(
			Effect.provide(
				BillingCheckoutCompletionServiceForDeploymentLive.pipe(
					Layer.provide(configLayer({ ...ORIGINS, IS_BILLING_ENFORCEMENT_ENABLED: 'false' })),
				),
			),
		),
	)
})

describe('OnboardingService without email', () => {
	it.effect('starts without RESEND_PRODUCT_USERS_SEGMENT_ID and does nothing', () =>
		Effect.gen(function* () {
			const onboarding = yield* OnboardingService
			// WorkOS and Postgres are mocks that die when used: the disabled service touches neither.
			yield* onboarding.enrollMember({ userId: 'user-1', organizationId: 'org-1' })
			yield* onboarding.recordRpiTaskCreated({
				userId: 'user-1',
				taskId: 'task-1',
				workflowType: 'rpi',
				isDraft: false,
			})
		}).pipe(
			Effect.provide(
				OnboardingServiceLive.pipe(
					Layer.provide(
						Layer.mergeAll(
							Layer.succeed(ResendService, unconfiguredResendService),
							Layer.mock(WorkosService, {}),
							PostgresDbLive(db),
							configLayer({}),
						),
					),
				),
			),
		),
	)
})

const ACCESS_REQUESTED_AT = new Date('2026-11-01T00:00:00Z')
const REMINDER_SCHEDULED_AT = new Date('2026-11-03T00:00:00Z')

describe('access request admin notification without email', () => {
	it.effect('skips quietly instead of logging an error', ({ expect }) =>
		Effect.gen(function* () {
			const captured = makeCapturedEffectLogs()
			const admin = { userId: 'admin-1', email: 'admin@example.test', firstName: null }
			const result = yield* notifyAdmin({
				request: {
					id: 'request-1',
					request_generation: 1,
					artifact_id: 'artifact-1',
					artifact_title_snapshot: 'Design',
					artifact_owner_user_id: 'owner-1',
					organization_id: 'org-1',
					workosOrganizationId: 'org_workos_1',
					organizationName: 'Example',
					requestedAt: ACCESS_REQUESTED_AT,
					requesterEmail: 'requester@example.test',
					requesterUserId: null,
					taskId: null,
					taskName: null,
				},
				admin,
				scheduledAt: REMINDER_SCHEDULED_AT,
				requesterDisplay: 'requester@example.test',
				requesterFirstName: null,
				artifactOwnerName: null,
				inviteUrl: 'https://cloud.example.test/admin/invitations',
				taskUrl: null,
				artifactUrl: null,
				resend: unconfiguredResendService,
			}).pipe(Effect.provide(captured.layer))

			expect(result).toEqual({ ok: false, skipped: true, admin, error: 'email_not_configured' })
			expect(captured.logs.filter((log) => log.level === 'Error')).toEqual([])
		}),
	)
})
