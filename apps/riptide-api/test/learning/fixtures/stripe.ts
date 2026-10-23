import { type ChildProcessWithoutNullStreams, spawn, spawnSync } from 'node:child_process'
import type { Readable } from 'node:stream'

import type { ReadableStripeSubscriptionCache, StripeSubscriptionCache } from '@humanlayer/billing/billing-kv'
import Stripe from 'stripe'

type TestBillingKvStore = {
	getOrgCustomerId(organizationId: string): Promise<string | null>
	setOrgCustomerId(organizationId: string, customerId: string): Promise<void>
	getCustomerOrgId(customerId: string): Promise<string | null>
	setCustomerOrgId(customerId: string, organizationId: string): Promise<void>
	getSubscriptionCache(customerId: string): Promise<ReadableStripeSubscriptionCache | null>
	setSubscriptionCache(customerId: string, cache: StripeSubscriptionCache): Promise<void>
}

const DEFAULT_CLOCK_READY_TIMEOUT_MS = 120_000
const DEFAULT_CLOCK_READY_POLL_INTERVAL_MS = 2_000
const LISTENER_STARTUP_DELAY_MS = 3_000

type StripeFixtureOptions = {
	secretKey?: string
	clockReadyTimeoutMs?: number
	clockReadyPollIntervalMs?: number
}

type CreateClockedSubscriptionInput = {
	customerId: string
	priceId?: string
	currency?: string
	unitAmount?: number
	interval?: Stripe.PriceCreateParams.Recurring.Interval
	trialPeriodDays?: number
}

export type Phase3LifecycleFixture = {
	organizationId: string
	customerId: string
	clockId: string
	linkCustomerViaMetadata(): Promise<void>
	seedKvMappings(): Promise<void>
	createTrialSubscription(): Promise<Stripe.Subscription>
	advanceClockTo(unixTime: number): Promise<Stripe.TestHelpers.TestClock>
	readKvState(): Promise<ReadableStripeSubscriptionCache | null>
}

export type StripeFixture = {
	stripe: Stripe
	webhookSecret: string
	listener: ChildProcessWithoutNullStreams | null
	testClockIds: string[]
	getWebhookSecret(): Promise<string>
	startListener(forwardTo: string): Promise<void>
	createTestClock(name?: string): Promise<Stripe.TestHelpers.TestClock>
	waitForClockReady(clockId: string): Promise<Stripe.TestHelpers.TestClock>
	createClockedCustomer(clockId: string, overrides?: Stripe.CustomerCreateParams): Promise<Stripe.Customer>
	createClockedSubscription(input: CreateClockedSubscriptionInput): Promise<Stripe.Subscription>
	createPhase3LifecycleFixture(input: {
		kv: TestBillingKvStore
		organizationId: string
		priceId?: string
		customerMetadataKey?: 'organizationId' | 'internal_org_id' | 'organization_id'
	}): Promise<Phase3LifecycleFixture>
	shutdown(): Promise<void>
}

function readText(stream: Readable | null | undefined): Promise<string> {
	if (!stream) {
		return Promise.resolve('')
	}

	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = []
		stream.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
		stream.on('error', reject)
		stream.on('end', () => resolve(Buffer.concat(chunks).toString()))
	})
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function createStripeFixture(options: StripeFixtureOptions = {}): Promise<StripeFixture> {
	const secretKey = options.secretKey ?? process.env.STRIPE_SECRET_KEY
	if (!secretKey) {
		throw new Error('STRIPE_SECRET_KEY is required for live Stripe learning tests')
	}

	const isStripeTestKey = secretKey.startsWith('sk_test_') || secretKey.startsWith('rk_test_')
	if (!isStripeTestKey) {
		throw new Error('Stripe learning tests require a Stripe test-mode secret key (sk_test_* or rk_test_*)')
	}

	const stripe = new Stripe(secretKey)
	const testClockIds: string[] = []
	let webhookSecret = ''
	let listener: ChildProcessWithoutNullStreams | null = null
	const clockReadyTimeoutMs = options.clockReadyTimeoutMs ?? DEFAULT_CLOCK_READY_TIMEOUT_MS
	const clockReadyPollIntervalMs = options.clockReadyPollIntervalMs ?? DEFAULT_CLOCK_READY_POLL_INTERVAL_MS

	async function getWebhookSecret(): Promise<string> {
		if (webhookSecret) {
			return webhookSecret
		}

		const result = spawnSync('stripe', ['listen', '--print-secret'], { env: process.env })

		const stdout = result.stdout.toString().trim()
		const stderr = result.stderr.toString().trim()

		if (result.status !== 0) {
			throw new Error(
				`Failed to capture Stripe webhook secret (exit ${result.status}): ${stderr || stdout || 'no output'}`,
			)
		}

		if (!stdout.startsWith('whsec_')) {
			throw new Error(`Unexpected Stripe webhook secret output: ${stdout || '<empty>'}`)
		}

		webhookSecret = stdout
		return webhookSecret
	}

	async function startListener(forwardTo: string): Promise<void> {
		const secret = await getWebhookSecret()

		listener = spawn('stripe', ['listen', '--forward-to', forwardTo], {
			env: {
				...process.env,
				STRIPE_WEBHOOK_SECRET: secret,
			},
		})

		await sleep(LISTENER_STARTUP_DELAY_MS)

		if (listener.exitCode !== null) {
			const stderr = (await readText(listener.stderr)).trim()
			const stdout = (await readText(listener.stdout)).trim()
			throw new Error(
				`Stripe listener exited before tests started (exit ${listener.exitCode}): ${stderr || stdout || 'no output'}`,
			)
		}
	}

	async function createTestClock(name = 'phase-3-webhook-test'): Promise<Stripe.TestHelpers.TestClock> {
		const clock = await stripe.testHelpers.testClocks.create({
			frozen_time: Math.floor(Date.now() / 1000),
			name,
		})
		testClockIds.push(clock.id)
		return clock
	}

	async function waitForClockReady(clockId: string): Promise<Stripe.TestHelpers.TestClock> {
		const startedAt = Date.now()

		while (Date.now() - startedAt < clockReadyTimeoutMs) {
			const clock = await stripe.testHelpers.testClocks.retrieve(clockId)
			if (clock.status === 'ready') {
				return clock
			}

			if (clock.status === 'internal_failure') {
				throw new Error(`Stripe test clock ${clockId} entered internal_failure state`)
			}

			await sleep(clockReadyPollIntervalMs)
		}

		throw new Error(`Timed out waiting for Stripe test clock ${clockId} to become ready`)
	}

	async function createClockedCustomer(
		clockId: string,
		overrides: Stripe.CustomerCreateParams = {},
	): Promise<Stripe.Customer> {
		return await stripe.customers.create({
			email: overrides.email ?? `phase-3-${clockId}@example.com`,
			test_clock: clockId,
			...overrides,
		})
	}

	async function createClockedSubscription(input: CreateClockedSubscriptionInput): Promise<Stripe.Subscription> {
		const price =
			input.priceId ??
			(
				await stripe.prices.create({
					currency: input.currency ?? 'usd',
					unit_amount: input.unitAmount ?? 500,
					recurring: { interval: input.interval ?? 'month' },
					product_data: {
						name: `Phase 3 test subscription ${Date.now()}`,
					},
				})
			).id

		return await stripe.subscriptions.create({
			customer: input.customerId,
			collection_method: 'send_invoice',
			days_until_due: 1,
			items: [{ price }],
			...(typeof input.trialPeriodDays === 'number' ? { trial_period_days: input.trialPeriodDays } : {}),
		})
	}

	async function createPhase3LifecycleFixture(input: {
		kv: TestBillingKvStore
		organizationId: string
		priceId?: string
		customerMetadataKey?: 'organizationId' | 'internal_org_id' | 'organization_id'
	}): Promise<Phase3LifecycleFixture> {
		const metadataKey = input.customerMetadataKey ?? 'organizationId'
		const clock = await createTestClock(`phase-3-lifecycle-${Date.now()}`)
		await waitForClockReady(clock.id)

		const customer = await createClockedCustomer(clock.id, {
			metadata: {
				[metadataKey]: input.organizationId,
			},
		})

		return {
			organizationId: input.organizationId,
			customerId: customer.id,
			clockId: clock.id,
			async linkCustomerViaMetadata() {
				await stripe.customers.update(customer.id, {
					metadata: {
						[metadataKey]: input.organizationId,
					},
				})
			},
			async seedKvMappings() {
				await input.kv.setOrgCustomerId(input.organizationId, customer.id)
				await input.kv.setCustomerOrgId(customer.id, input.organizationId)
			},
			async createTrialSubscription() {
				return await createClockedSubscription({
					customerId: customer.id,
					priceId: input.priceId,
					trialPeriodDays: 14,
				})
			},
			async advanceClockTo(unixTime: number) {
				await stripe.testHelpers.testClocks.advance(clock.id, {
					frozen_time: unixTime,
				})
				return await waitForClockReady(clock.id)
			},
			async readKvState() {
				return await input.kv.getSubscriptionCache(customer.id)
			},
		}
	}

	async function shutdown(): Promise<void> {
		if (listener) {
			const exited = new Promise((resolve) => listener?.once('exit', resolve))
			listener.kill()
			await exited
			listener = null
		}

		for (const clockId of testClockIds.splice(0).reverse()) {
			await stripe.testHelpers.testClocks.del(clockId)
		}
	}

	return {
		stripe,
		get listener() {
			return listener
		},
		get webhookSecret() {
			return webhookSecret
		},
		testClockIds,
		getWebhookSecret,
		startListener,
		createTestClock,
		waitForClockReady,
		createClockedCustomer,
		createClockedSubscription,
		createPhase3LifecycleFixture,
		shutdown,
	}
}
