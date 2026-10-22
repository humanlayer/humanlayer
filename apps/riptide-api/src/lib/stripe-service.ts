import { BillingKvService } from '@humanlayer/billing/billing-kv'
import type { BillingCheckoutClient } from '@humanlayer/riptide-api-contract/types/billing'
import { Effect } from 'effect'
import type Stripe from 'stripe'

import type { AppRuntime, BillingKvRuntime } from '../effects/app-runtime'
import { Sentry } from '../instrument'
import { logger } from '../logger'
import { requireEnvironment } from './environment'

export type BillingPaymentMethodDetails = {
	brand: string | null
	last4: string | null
	expMonth: number | null
	expYear: number | null
}

export type BillingDiscountDetails = {
	id: string
	promotionCodeId: string | null
	code: string | null
	name: string | null
	percentOff: number | null
	amountOff: number | null
	currency: string | null
	duration: string | null
}

export type { BillingCheckoutClient }

type BillingRedirectParam =
	| { readonly name: 'billing'; readonly value: 'starter_to_pro_finalized' | 'checkout_synced' }
	| {
			readonly name: 'billing_error'
			readonly value:
				| 'checkout_invalid_session'
				| 'checkout_plan_mismatch'
				| 'checkout_finalize_failed'
				| 'checkout_unavailable'
	  }

export function buildBillingClientUrl(input: {
	readonly client: BillingCheckoutClient
	readonly param?: BillingRedirectParam
}): string {
	const base = input.client === 'cloud' ? requireEnvironment('CLOUD_ORIGIN') : requireEnvironment('APP_ORIGIN')
	const path =
		input.client === 'cloud' ? '/settings' : input.client === 'native' ? '/billing/return' : '/settings/billing'
	const url = new URL(path, base)
	if (input.param) {
		url.searchParams.set(input.param.name, input.param.value)
	}
	return url.toString()
}

function buildCheckoutCompletionSuccessUrl(
	route: 'finalize-starter-to-pro-upgrade' | 'resync',
	client: BillingCheckoutClient,
): string {
	const url = new URL(
		`/billing/checkout/${route}`,
		requireEnvironment('RIPTIDE_API_ORIGIN', process.env.VITE_PUBLIC_RIPTIDE_API_ORIGIN ?? 'http://localhost:8700'),
	)
	return `${url.toString()}?session_id={CHECKOUT_SESSION_ID}&client=${client}`
}

function isExpandedDiscount(discount: string | Stripe.Discount): discount is Stripe.Discount {
	return typeof discount !== 'string'
}

function getExpandedDiscounts(subscription: Stripe.Subscription): Stripe.Discount[] {
	return subscription.discounts.filter(isExpandedDiscount)
}

function isNoUpcomingInvoiceError(error: unknown): boolean {
	if (typeof error !== 'object' || error === null) return false
	const candidate = error as { readonly code?: unknown; readonly statusCode?: unknown }
	return candidate.code === 'invoice_upcoming_none' || candidate.statusCode === 404
}

export interface IStripeService {
	readonly prices: { readonly pro: string; readonly starter: string }
	/** Validates a Stripe webhook signature and returns the parsed event. */
	verifyWebhook(body: string, signature: string): Promise<Stripe.Event>
	/** Creates a hosted Checkout session for starting or recovering a subscription. */
	createCheckoutSession(input: {
		checkoutAttemptId: string
		customerId: string
		organizationId: string
		client: BillingCheckoutClient
		quantity: number
		promoCode?: string
	}): Promise<{ url: string }>
	/** Creates a hosted Checkout session for upgrading Starter customers to paid Pro. */
	createProUpgradeCheckoutSession(input: {
		checkoutAttemptId: string
		customerId: string
		organizationId: string
		client: BillingCheckoutClient
		quantity: number
	}): Promise<{ url: string }>
	/** Ensures Starter exists before canceling the customer's current paid Pro subscription. */
	downgradeProToStarter(input: { customerId: string; organizationId: string; quantity: number }): Promise<{
		starterSubscriptionId: string
		starterCreated: boolean
		canceledProSubscriptionId: string
	}>
	/** Finds an active Pro subscription with evidence of payment. */
	findActivePaidProSubscription(input: { customerId: string }): Promise<{ subscriptionId: string } | null>
	/** Finds a non-canceled Starter subscription for cleanup after Pro upgrade. */
	findNonCanceledStarterSubscription(input: { customerId: string }): Promise<{ subscriptionId: string } | null>
	isProPriceId(priceId: string | null | undefined): boolean
	isStarterPriceId(priceId: string | null | undefined): boolean
	/** Cancels a subscription, treating already-canceled/missing subscriptions as a no-op. */
	cancelSubscription(input: { subscriptionId: string }): Promise<void>
	/** Creates a hosted Billing Portal session for an existing Stripe customer. */
	createPortalSession(input: { customerId: string; returnUrl: string }): Promise<{ url: string }>
	/** Finds an active user-facing promotion code and returns its Stripe id plus canonical code. */
	resolvePromotionCode(code: string): Promise<{ id: string; code: string } | null>
	/** Sets the subscription discount list to the requested promotion code. */
	applyPromotionCode(input: { subscriptionId: string; promotionCodeId: string }): Promise<{
		subscriptionId: string
		promotionCodeId: string
		discountId: string | null
	}>
	/** Reads presentation-only billing details directly from Stripe without changing the billing cache. */
	getCurrentSubscriptionDetails(customerId: string): Promise<{
		subscriptionId: string
		paymentMethod: BillingPaymentMethodDetails | null
		discount: BillingDiscountDetails | null
	} | null>
	/** Reads the projected next invoice for a subscription, returning null when Stripe cannot produce one. */
	getUpcomingInvoice(subscriptionId: string): Promise<{ amountDue: number; currency: string } | null>
	/** Finds or creates the Stripe customer associated with an organization. */
	ensureStripeCustomerForOrg(input: {
		organizationId: string
		organizationName: string
		adminEmail: string
		existingCustomerId?: string | null
	}): Promise<{ customerId: string; created: boolean }>
	/** Persists bidirectional organization/customer billing mappings in Stripe and KV. */
	ensureBillingOrgMappings(input: { organizationId: string; customerId: string }): Promise<void>
	/** Ensures a Pro trial subscription exists for the customer at the requested seat quantity. */
	ensureProTrialSubscription(input: {
		customerId: string
		quantity: number
		trialDays: number
	}): Promise<{ subscriptionId: string; created: boolean }>
	/** Ensures a Starter subscription exists for the customer at the requested seat quantity. */
	ensureStarterSubscription(input: {
		customerId: string
		quantity: number
	}): Promise<{ subscriptionId: string; created: boolean }>
	/** Returns the current active/trialing/past-due subscription item used for seat sync. */
	findCurrentSubscriptionItemForCustomer(customerId: string): Promise<{
		subscriptionId: string
		subscriptionItemId: string
		priceId: string
		quantity: number | null
	} | null>
	/** Updates the quantity for a Stripe subscription item. */
	updateSubscriptionItemQuantity(input: {
		subscriptionItemId: string
		quantity: number
		prorationBehavior: Stripe.SubscriptionItemUpdateParams.ProrationBehavior
	}): Promise<{ subscriptionItemId: string; quantity: number | null }>
	/** Deletes a Stripe customer when a test or fixture needs cleanup. */
	deleteCustomer(customerId: string): Promise<void>
}

export class StripeService implements IStripeService {
	readonly prices: { readonly pro: string; readonly starter: string }

	constructor(
		private stripe: Stripe,
		private webhookSecret: string,
		private options: {
			billingKvRuntime: AppRuntime | BillingKvRuntime
			proPriceId: string
			starterPriceId: string
		},
	) {
		this.prices = { pro: options.proPriceId, starter: options.starterPriceId }
	}

	isProPriceId(priceId: string | null | undefined): boolean {
		return priceId === this.proPriceId()
	}

	isStarterPriceId(priceId: string | null | undefined): boolean {
		return priceId === this.starterPriceId()
	}

	/** Validates the webhook signature with the configured endpoint secret. */
	async verifyWebhook(body: string, signature: string): Promise<Stripe.Event> {
		return await this.stripe.webhooks.constructEventAsync(body, signature, this.webhookSecret)
	}

	/** Builds a Checkout session for creating or recovering a subscription, with optional initial promo. */
	async createCheckoutSession(input: {
		checkoutAttemptId: string
		customerId: string
		organizationId: string
		client: BillingCheckoutClient
		quantity: number
		promoCode?: string
	}): Promise<{ url: string }> {
		const { checkoutAttemptId, customerId, organizationId, client, quantity: requestedQuantity, promoCode } = input
		const quantity = this.normalizeQuantity(requestedQuantity)
		const priceId = this.proPriceId()
		const successUrl = buildCheckoutCompletionSuccessUrl('resync', client)
		const cancelUrl = buildBillingClientUrl({ client })
		await this.assertLicensedRecurringPrice(priceId, 'STRIPE_PRICE_PRO')

		logger.info(
			{ customerId, organizationId, priceId, quantity },
			'Creating Stripe checkout session for licensed subscription',
		)

		const sessionParams: Stripe.Checkout.SessionCreateParams = {
			customer: customerId,
			mode: 'subscription',
			line_items: [{ price: priceId, quantity }],
			allow_promotion_codes: true,
			success_url: successUrl,
			cancel_url: cancelUrl,
			metadata: this.buildOrganizationMetadata(organizationId),
		}
		if (promoCode) sessionParams.discounts = [{ promotion_code: promoCode }]

		const session = await this.stripe.checkout.sessions.create(sessionParams, {
			idempotencyKey: `checkout:${organizationId}:${checkoutAttemptId}`,
		})

		if (!session.url) {
			throw new Error('Stripe checkout session did not include a redirect url')
		}

		return { url: session.url }
	}

	async createProUpgradeCheckoutSession(input: {
		checkoutAttemptId: string
		customerId: string
		organizationId: string
		client: BillingCheckoutClient
		quantity: number
	}): Promise<{ url: string }> {
		const { checkoutAttemptId, customerId, organizationId, client, quantity: requestedQuantity } = input
		const quantity = this.normalizeQuantity(requestedQuantity)
		const priceId = this.proPriceId()
		const successUrl = buildCheckoutCompletionSuccessUrl('finalize-starter-to-pro-upgrade', client)
		const cancelUrl = buildBillingClientUrl({ client })
		await this.assertLicensedRecurringPrice(priceId, 'STRIPE_PRICE_PRO')

		logger.info(
			{ customerId, organizationId, priceId, quantity },
			'Creating Stripe checkout session for Starter to Pro upgrade',
		)

		const session = await this.stripe.checkout.sessions.create(
			{
				customer: customerId,
				mode: 'subscription',
				line_items: [{ price: priceId, quantity }],
				allow_promotion_codes: true,
				success_url: successUrl,
				cancel_url: cancelUrl,
				metadata: this.buildOrganizationMetadata(organizationId),
			},
			{ idempotencyKey: `checkout-upgrade:${organizationId}:${checkoutAttemptId}` },
		)

		if (!session.url) {
			throw new Error('Stripe checkout session did not include a redirect url')
		}

		return { url: session.url }
	}

	async findActivePaidProSubscription(input: { customerId: string }): Promise<{ subscriptionId: string } | null> {
		const subscriptions = await this.stripe.subscriptions.list({
			customer: input.customerId,
			status: 'all',
			limit: 10,
		})

		const proSubscription = subscriptions.data.find(
			(subscription) =>
				subscription.status === 'active' &&
				subscription.items.data.some((item) => item.price.id === this.proPriceId()),
		)
		if (!proSubscription) {
			return null
		}

		const invoices = await this.stripe.invoices.list({
			customer: input.customerId,
			subscription: proSubscription.id,
			status: 'paid',
			limit: 1,
		})

		return invoices.data.length > 0 ? { subscriptionId: proSubscription.id } : null
	}

	async downgradeProToStarter(input: { customerId: string; organizationId: string; quantity: number }): Promise<{
		starterSubscriptionId: string
		starterCreated: boolean
		canceledProSubscriptionId: string
	}> {
		const { customerId, organizationId, quantity: requestedQuantity } = input
		const quantity = this.normalizeQuantity(requestedQuantity)
		const proSubscription = await this.findActivePaidProSubscription({ customerId })
		if (!proSubscription) {
			throw new Error(`No active paid Pro subscription found for customer ${customerId}`)
		}

		const starterSubscription = await this.ensureStarterSubscriptionForDowngrade({ customerId, quantity })
		await this.cancelSubscription({ subscriptionId: proSubscription.subscriptionId })

		logger.info(
			{
				customerId,
				organizationId,
				quantity,
				starterSubscriptionId: starterSubscription.subscriptionId,
				starterCreated: starterSubscription.created,
				canceledProSubscriptionId: proSubscription.subscriptionId,
			},
			'Downgraded Stripe customer from Pro to Starter',
		)

		return {
			starterSubscriptionId: starterSubscription.subscriptionId,
			starterCreated: starterSubscription.created,
			canceledProSubscriptionId: proSubscription.subscriptionId,
		}
	}

	async findNonCanceledStarterSubscription(input: {
		customerId: string
	}): Promise<{ subscriptionId: string } | null> {
		const subscriptions = await this.stripe.subscriptions.list({
			customer: input.customerId,
			status: 'all',
			limit: 10,
		})

		const starterSubscription = subscriptions.data.find(
			(subscription) =>
				subscription.status !== 'canceled' &&
				subscription.items.data.some((item) => item.price.id === this.starterPriceId()),
		)

		return starterSubscription ? { subscriptionId: starterSubscription.id } : null
	}

	async cancelSubscription(input: { subscriptionId: string }): Promise<void> {
		try {
			await this.stripe.subscriptions.cancel(input.subscriptionId)
		} catch (error) {
			const status =
				(error as { statusCode?: number; status?: number }).statusCode ?? (error as { status?: number }).status
			if (status === 404) {
				logger.warn(
					{ subscriptionId: input.subscriptionId },
					'Stripe subscription missing during cancel; treating as no-op',
				)
				return
			}
			throw error
		}
	}

	/** Builds a Billing Portal session for a customer that already exists in Stripe. */
	async createPortalSession(input: { customerId: string; returnUrl: string }): Promise<{ url: string }> {
		const { customerId, returnUrl } = input

		const session = await this.stripe.billingPortal.sessions.create({
			customer: customerId,
			return_url: returnUrl,
		})

		return { url: session.url }
	}

	/** Looks up an active promotion code by the human-entered code string. */
	async resolvePromotionCode(code: string): Promise<{ id: string; code: string } | null> {
		const promotionCodes = await this.stripe.promotionCodes.list({
			code,
			active: true,
			limit: 1,
		})

		const promotionCode = promotionCodes.data[0]
		if (!promotionCode) {
			return null
		}

		return { id: promotionCode.id, code: promotionCode.code }
	}

	/** Applies exactly one promotion-code discount to a subscription, replacing any current discounts. */
	async applyPromotionCode(input: { subscriptionId: string; promotionCodeId: string }): Promise<{
		subscriptionId: string
		promotionCodeId: string
		discountId: string | null
	}> {
		const { subscriptionId, promotionCodeId } = input

		const subscription = await this.stripe.subscriptions.update(subscriptionId, {
			discounts: [{ promotion_code: promotionCodeId }],
		})
		const discount = getExpandedDiscounts(subscription)[0]

		return {
			subscriptionId: subscription.id,
			promotionCodeId,
			discountId: typeof discount?.id === 'string' ? discount.id : null,
		}
	}

	/** Fetches card and discount details for the current non-canceled subscription. */
	async getCurrentSubscriptionDetails(customerId: string): Promise<{
		subscriptionId: string
		paymentMethod: BillingPaymentMethodDetails | null
		discount: BillingDiscountDetails | null
	} | null> {
		const subscriptions = await this.stripe.subscriptions.list({
			customer: customerId,
			limit: 5,
			status: 'all',
			expand: [
				'data.default_payment_method',
				'data.discounts',
				'data.discounts.promotion_code',
				'data.discounts.source.coupon',
			],
		})

		const subscription = subscriptions.data.find((candidate) => candidate.status !== 'canceled')
		if (!subscription) {
			return null
		}

		return {
			subscriptionId: subscription.id,
			paymentMethod: this.extractPaymentMethodDetails(subscription.default_payment_method),
			discount: this.extractDiscountDetails(subscription),
		}
	}

	/** Fetches the upcoming invoice estimate for a subscription when Stripe can calculate one. */
	async getUpcomingInvoice(subscriptionId: string): Promise<{ amountDue: number; currency: string } | null> {
		try {
			const invoice = await this.stripe.invoices.createPreview({ subscription: subscriptionId })
			return {
				amountDue: invoice.amount_due,
				currency: invoice.currency,
			}
		} catch (error) {
			if (isNoUpcomingInvoiceError(error)) {
				logger.info({ subscriptionId }, 'Stripe has no upcoming invoice for subscription')
				return null
			}
			logger.error({ err: error, subscriptionId }, 'Failed to retrieve upcoming Stripe invoice for billing info')
			Sentry.captureException(error, {
				tags: { error_type: 'stripe_upcoming_invoice_error', operation: 'get_upcoming_invoice' },
				extra: { subscriptionId },
			})
			return null
		}
	}

	/** Reuses a known customer when possible, otherwise creates and tags a new Stripe customer for the org. */
	async ensureStripeCustomerForOrg(input: {
		organizationId: string
		organizationName: string
		adminEmail: string
		existingCustomerId?: string | null
	}): Promise<{ customerId: string; created: boolean }> {
		const { organizationId, organizationName, adminEmail, existingCustomerId } = input
		const metadata = this.buildOrganizationMetadata(organizationId)
		const candidateCustomerIds = new Set<string>()

		if (existingCustomerId) {
			candidateCustomerIds.add(existingCustomerId)
		}

		const mappedCustomerId = await this.options.billingKvRuntime.runPromise(
			Effect.gen(function* () {
				const billingKv = yield* BillingKvService
				return yield* billingKv.getOrgCustomerId({ organizationId })
			}),
		)
		if (mappedCustomerId) {
			candidateCustomerIds.add(mappedCustomerId)
		}

		for (const candidateCustomerId of candidateCustomerIds) {
			const customer = await this.retrieveActiveCustomer(candidateCustomerId)
			if (!customer) {
				continue
			}

			await this.stripe.customers.update(customer.id, {
				name: organizationName,
				email: adminEmail,
				metadata: {
					...customer.metadata,
					...metadata,
				},
			})

			return { customerId: customer.id, created: false }
		}

		const customer = await this.stripe.customers.create({
			name: organizationName,
			email: adminEmail,
			metadata,
		})

		return { customerId: customer.id, created: true }
	}

	/** Ensures KV and Stripe customer metadata both point back to the internal organization id. */
	async ensureBillingOrgMappings(input: { organizationId: string; customerId: string }): Promise<void> {
		const { organizationId, customerId } = input
		await this.options.billingKvRuntime.runPromise(
			Effect.gen(function* () {
				const billingKv = yield* BillingKvService
				yield* billingKv.setOrgCustomerId({ organizationId, customerId })
				yield* billingKv.setCustomerOrgId({ customerId, organizationId })
			}),
		)

		const customer = await this.retrieveActiveCustomer(customerId)
		if (!customer) {
			throw new Error(`Stripe customer ${customerId} was not found while ensuring org mappings`)
		}

		await this.stripe.customers.update(customerId, {
			metadata: {
				...customer.metadata,
				...this.buildOrganizationMetadata(organizationId),
			},
		})
	}

	/** Creates a Pro trial subscription unless the customer already has a non-canceled subscription. */
	async ensureProTrialSubscription(input: {
		customerId: string
		quantity: number
		trialDays: number
	}): Promise<{ subscriptionId: string; created: boolean }> {
		const { customerId, quantity: requestedQuantity, trialDays } = input
		const quantity = this.normalizeQuantity(requestedQuantity)

		if (!Number.isInteger(trialDays) || trialDays <= 0) {
			throw new Error(`Expected trialDays to be a positive integer, received ${trialDays}`)
		}

		const existingSubscriptions = await this.stripe.subscriptions.list({
			customer: customerId,
			status: 'all',
			limit: 5,
		})

		const activeSubscription = existingSubscriptions.data.find((subscription) => subscription.status !== 'canceled')
		if (activeSubscription) {
			return {
				subscriptionId: activeSubscription.id,
				created: false,
			}
		}

		const subscription = await this.stripe.subscriptions.create({
			customer: customerId,
			items: [{ price: this.proPriceId(), quantity }],
			trial_period_days: trialDays,
			trial_settings: {
				end_behavior: {
					missing_payment_method: 'cancel',
				},
			},
		})

		return {
			subscriptionId: subscription.id,
			created: true,
		}
	}

	/** Creates a Starter subscription unless the customer already has a non-canceled subscription. */
	async ensureStarterSubscription(input: {
		customerId: string
		quantity: number
	}): Promise<{ subscriptionId: string; created: boolean }> {
		const { customerId, quantity: requestedQuantity } = input
		const quantity = this.normalizeQuantity(requestedQuantity)

		const existingSubscriptions = await this.stripe.subscriptions.list({
			customer: customerId,
			status: 'all',
			limit: 5,
		})

		const activeSubscription = existingSubscriptions.data.find((subscription) => subscription.status !== 'canceled')
		if (activeSubscription) {
			return {
				subscriptionId: activeSubscription.id,
				created: false,
			}
		}

		const subscription = await this.stripe.subscriptions.create({
			customer: customerId,
			items: [{ price: this.starterPriceId(), quantity }],
		})

		return {
			subscriptionId: subscription.id,
			created: true,
		}
	}

	/** Locates the first non-canceled subscription item for customer-level billing actions. */
	async findCurrentSubscriptionItemForCustomer(customerId: string): Promise<{
		subscriptionId: string
		subscriptionItemId: string
		priceId: string
		quantity: number | null
	} | null> {
		const subscriptions = await this.stripe.subscriptions.list({
			customer: customerId,
			status: 'all',
			limit: 5,
		})

		const subscription = subscriptions.data.find((candidate) => candidate.status !== 'canceled')
		const subscriptionItem = subscription?.items.data[0]
		if (!subscription || !subscriptionItem) {
			return null
		}

		return {
			subscriptionId: subscription.id,
			subscriptionItemId: subscriptionItem.id,
			priceId: subscriptionItem.price.id,
			quantity: subscriptionItem.quantity ?? null,
		}
	}

	/** Pushes the latest billable seat count to Stripe using the requested proration behavior. */
	async updateSubscriptionItemQuantity(input: {
		subscriptionItemId: string
		quantity: number
		prorationBehavior: Stripe.SubscriptionItemUpdateParams.ProrationBehavior
	}): Promise<{ subscriptionItemId: string; quantity: number | null }> {
		const { subscriptionItemId, quantity, prorationBehavior } = input

		if (!Number.isInteger(quantity) || quantity < 1) {
			throw new Error(`Expected quantity to be a positive integer, received ${quantity}`)
		}

		const subscriptionItem = await this.stripe.subscriptionItems.update(subscriptionItemId, {
			quantity,
			proration_behavior: prorationBehavior,
		})

		return {
			subscriptionItemId: subscriptionItem.id,
			quantity: subscriptionItem.quantity ?? null,
		}
	}

	/** Deletes a Stripe customer; primarily used by tests and fixtures for cleanup. */
	async deleteCustomer(customerId: string): Promise<void> {
		await this.stripe.customers.del(customerId)
	}

	private async ensureStarterSubscriptionForDowngrade(input: {
		customerId: string
		quantity: number
	}): Promise<{ subscriptionId: string; created: boolean }> {
		const { customerId, quantity } = input
		const subscriptions = await this.stripe.subscriptions.list({
			customer: customerId,
			status: 'all',
			limit: 10,
		})

		const starterSubscription = subscriptions.data.find(
			(subscription) =>
				subscription.status !== 'canceled' &&
				subscription.items.data.some((item) => item.price.id === this.starterPriceId()),
		)
		const starterItem = starterSubscription?.items.data.find((item) => item.price.id === this.starterPriceId())
		if (starterSubscription && starterItem) {
			if (starterItem.quantity !== quantity) {
				await this.stripe.subscriptionItems.update(starterItem.id, {
					quantity,
					proration_behavior: 'none',
				})
			}

			return { subscriptionId: starterSubscription.id, created: false }
		}

		const subscription = await this.stripe.subscriptions.create({
			customer: customerId,
			items: [{ price: this.starterPriceId(), quantity }],
		})

		return { subscriptionId: subscription.id, created: true }
	}

	private proPriceId(): string {
		return this.prices.pro
	}

	private async assertLicensedRecurringPrice(priceId: string, envName: string): Promise<void> {
		const price = await this.stripe.prices.retrieve(priceId)
		if (price.recurring?.usage_type === 'metered') {
			throw new Error(
				`${envName} points to a metered Stripe price (${priceId}); use the licensed per-seat Pro price from the Stripe Pulumi stack output instead`,
			)
		}
	}

	private starterPriceId(): string {
		return this.prices.starter
	}

	private normalizeQuantity(quantity: number): number {
		if (!Number.isInteger(quantity) || quantity < 1) {
			throw new Error(`Expected quantity to be a positive integer, received ${quantity}`)
		}

		return quantity
	}

	private buildOrganizationMetadata(organizationId: string) {
		return {
			organizationId,
			internal_org_id: organizationId,
			organization_id: organizationId,
		}
	}

	private async retrieveActiveCustomer(customerId: string): Promise<Stripe.Customer | null> {
		try {
			const customer = await this.stripe.customers.retrieve(customerId)
			if (customer.deleted) {
				logger.warn({ customerId }, 'Stripe customer is deleted and cannot be reused')
				return null
			}

			return customer
		} catch (error) {
			logger.warn(
				{ err: error, customerId },
				'Failed to load Stripe customer while ensuring org billing provisioning',
			)
			return null
		}
	}

	private extractPaymentMethodDetails(paymentMethod: unknown): BillingPaymentMethodDetails | null {
		if (!paymentMethod || typeof paymentMethod === 'string') {
			return null
		}

		const card = (paymentMethod as { card?: Stripe.PaymentMethod.Card }).card
		if (!card) {
			return null
		}

		return {
			brand: card.brand ?? null,
			last4: card.last4 ?? null,
			expMonth: card.exp_month ?? null,
			expYear: card.exp_year ?? null,
		}
	}

	private extractDiscountDetails(subscription: Stripe.Subscription): BillingDiscountDetails | null {
		const discount = getExpandedDiscounts(subscription)[0]
		if (!discount || typeof discount.id !== 'string') {
			return null
		}

		const promotionCode = discount.promotion_code
		const sourceCoupon = discount.source.coupon
		const coupon = typeof sourceCoupon === 'object' ? sourceCoupon : null
		const expandedPromotionCode = typeof promotionCode === 'object' ? promotionCode : null

		return {
			id: discount.id,
			promotionCodeId:
				typeof promotionCode === 'string'
					? promotionCode
					: expandedPromotionCode
						? expandedPromotionCode.id
						: null,
			code: expandedPromotionCode?.code ?? null,
			name: typeof coupon?.name === 'string' ? coupon.name : null,
			percentOff: typeof coupon?.percent_off === 'number' ? coupon.percent_off : null,
			amountOff: typeof coupon?.amount_off === 'number' ? coupon.amount_off : null,
			currency: typeof coupon?.currency === 'string' ? coupon.currency : null,
			duration: typeof coupon?.duration === 'string' ? coupon.duration : null,
		}
	}
}
