import type Stripe from 'stripe'

type MockStripeBillingOptions = {
	customerId?: string
	organizationId?: string | null
	metadata?: Record<string, string>
	includeSubscription?: boolean
	subscriptionId?: string
	subscriptionStatus?: Stripe.Subscription.Status
	priceId?: string
	currentPeriodEnd?: number
	quantity?: number
	paidInvoiceCount?: number
	promotionCodes?: Array<{ id: string; code: string; active?: boolean }>
	appliedDiscountId?: string | null
	paymentMethod?: { brand?: string; last4?: string; expMonth?: number; expYear?: number } | null
	discount?: {
		id: string
		promotionCodeId?: string | null
		code?: string | null
		name?: string | null
		percentOff?: number | null
		amountOff?: number | null
		currency?: string | null
		duration?: string | null
	} | null
	upcomingInvoice?: { amountDue: number; currency: string } | null
	upcomingInvoiceError?: Error
	subscriptionCreateError?: Error
	customerDeleted?: boolean
	existingSubscriptions?: Array<{
		id: string
		status: Stripe.Subscription.Status
		priceId?: string
		currentPeriodEnd?: number
	}>
}

export function createMockStripeBillingClient(options?: MockStripeBillingOptions): Stripe {
	const customerId = options?.customerId ?? 'cus_test'
	const organizationId = options?.organizationId ?? 'org_test'
	const includeSubscription = options?.includeSubscription ?? true
	const paidInvoiceCount = options?.paidInvoiceCount ?? 0
	const currentPeriodEnd = options?.currentPeriodEnd ?? 1_900_000_000
	const quantity = options?.quantity ?? 1
	const subscriptionItemUpdates: Array<{
		subscriptionItemId: string
		quantity: number
		prorationBehavior: Stripe.SubscriptionItemUpdateParams.ProrationBehavior | undefined
	}> = []
	const checkoutSessions: Array<any> = []
	const checkoutSessionRequestOptions: Array<Stripe.RequestOptions | undefined> = []
	const createdSubscriptions: Array<any> = []
	const promotionCodeLists: Array<any> = []
	const subscriptionUpdates: Array<{ subscriptionId: string; params: any }> = []
	const subscriptionCancellations: Array<string> = []
	const subscriptionLists: Array<any> = []
	const upcomingInvoiceRetrievals: Array<any> = []
	const operationLog: string[] = []
	const metadata = options?.metadata ?? (organizationId ? { organizationId } : {})
	const paymentMethod = options?.paymentMethod
		? {
				id: 'pm_test',
				object: 'payment_method',
				card: {
					brand: options.paymentMethod.brand ?? 'visa',
					last4: options.paymentMethod.last4 ?? '4242',
					exp_month: options.paymentMethod.expMonth ?? 12,
					exp_year: options.paymentMethod.expYear ?? 2030,
				},
			}
		: null
	const configuredDiscount = options?.discount
	const expandedDiscount = configuredDiscount
		? {
				id: configuredDiscount.id,
				promotion_code: configuredDiscount.promotionCodeId
					? { id: configuredDiscount.promotionCodeId, code: configuredDiscount.code ?? null }
					: null,
				source: {
					coupon: {
						id: 'coupon_test',
						name: configuredDiscount.name ?? null,
						percent_off: configuredDiscount.percentOff ?? null,
						amount_off: configuredDiscount.amountOff ?? null,
						currency: configuredDiscount.currency ?? null,
						duration: configuredDiscount.duration ?? null,
					},
				},
			}
		: null

	const defaultSubscription = {
		id: options?.subscriptionId ?? 'sub_test',
		status: options?.subscriptionStatus ?? 'trialing',
		current_period_end: currentPeriodEnd,
		default_payment_method: paymentMethod,
		items: {
			data: [{ id: 'si_test', price: { id: options?.priceId ?? 'price_test' }, quantity }],
		},
		discounts: expandedDiscount
			? [expandedDiscount]
			: options?.appliedDiscountId === undefined
				? []
				: [{ id: options.appliedDiscountId }],
	}

	const existingSubscriptions = options?.existingSubscriptions?.map((subscription) => ({
		id: subscription.id,
		status: subscription.status,
		items: {
			data: [{ id: `si_${subscription.id}`, price: { id: subscription.priceId ?? 'price_test' }, quantity }],
		},
		current_period_end: subscription.currentPeriodEnd ?? currentPeriodEnd,
		default_payment_method: paymentMethod,
		discounts: expandedDiscount ? [expandedDiscount] : [],
	}))

	const subscriptions = existingSubscriptions ?? (includeSubscription ? [defaultSubscription] : [])

	const invoices = Array.from({ length: paidInvoiceCount }, (_, index) => ({
		id: `in_test_${index}`,
	}))

	const customer = options?.customerDeleted
		? { id: customerId, object: 'customer', deleted: true }
		: { id: customerId, object: 'customer', metadata, deleted: false }

	return {
		subscriptions: {
			list: async (params: any) => {
				subscriptionLists.push(params)
				operationLog.push('subscriptions.list')
				return { data: subscriptions }
			},
			create: async (params: any) => {
				operationLog.push('subscriptions.create')
				if (options?.subscriptionCreateError) {
					throw options.subscriptionCreateError
				}

				createdSubscriptions.push(params)
				const subscription = {
					id: `sub_created_${params.customer}`,
					status: (params.trial_period_days ? 'trialing' : 'active') as Stripe.Subscription.Status,
					items: {
						data: [
							{
								id: `si_sub_created_${params.customer}`,
								price: { id: params.items?.[0]?.price ?? 'price_test' },
								quantity: params.items?.[0]?.quantity,
								current_period_end: currentPeriodEnd,
							},
						],
					},
					default_payment_method: paymentMethod,
					discounts: expandedDiscount ? [expandedDiscount] : [],
					current_period_end: currentPeriodEnd,
				}
				subscriptions.unshift(subscription)
				return subscription
			},
			update: async (subscriptionId: string, params: any) => {
				operationLog.push('subscriptions.update')
				subscriptionUpdates.push({ subscriptionId, params })
				const subscription =
					subscriptions.find((candidate) => candidate.id === subscriptionId) ?? defaultSubscription
				return {
					...subscription,
					id: subscriptionId,
					discounts: options?.appliedDiscountId === undefined ? [] : [{ id: options.appliedDiscountId }],
				}
			},
			cancel: async (subscriptionId: string) => {
				operationLog.push('subscriptions.cancel')
				subscriptionCancellations.push(subscriptionId)
				const subscription = subscriptions.find((candidate) => candidate.id === subscriptionId)
				if (subscription) {
					subscription.status = 'canceled'
					return subscription
				}

				return {
					id: subscriptionId,
					status: 'canceled',
					items: { data: [] },
				}
			},
		},
		promotionCodes: {
			list: async (params: any) => {
				promotionCodeLists.push(params)
				const promotionCodes = options?.promotionCodes ?? []
				return {
					data: promotionCodes.filter(
						(promotionCode) =>
							promotionCode.code === params.code &&
							(params.active === undefined || (promotionCode.active ?? true) === params.active),
					),
				}
			},
		},
		checkout: {
			sessions: {
				create: async (params: any, requestOptions?: Stripe.RequestOptions) => {
					checkoutSessions.push(params)
					checkoutSessionRequestOptions.push(requestOptions)
					return { id: 'cs_test', url: 'https://checkout.stripe.com/c/pay/cs_test' }
				},
			},
		},
		customers: {
			retrieve: async () => customer,
			create: async (params: any) => ({
				id: params.id ?? customerId,
				deleted: false,
				metadata: params.metadata ?? {},
			}),
			update: async (_id: string, params: any) => ({
				id: customerId,
				deleted: false,
				metadata: params.metadata ?? metadata,
			}),
			del: async () => ({ id: customerId, deleted: true }),
		},
		subscriptionItems: {
			update: async (subscriptionItemId: string, params: any) => {
				operationLog.push('subscriptionItems.update')
				subscriptionItemUpdates.push({
					subscriptionItemId,
					quantity: params.quantity,
					prorationBehavior: params.proration_behavior,
				})
				return { id: subscriptionItemId, quantity: params.quantity }
			},
		},
		invoices: {
			list: async () => ({ data: invoices }),
			createPreview: async (params: any) => {
				upcomingInvoiceRetrievals.push(params)
				if (options?.upcomingInvoiceError) {
					throw options.upcomingInvoiceError
				}

				return {
					amount_due: options?.upcomingInvoice?.amountDue ?? 1000,
					currency: options?.upcomingInvoice?.currency ?? 'usd',
				}
			},
			retrieveUpcoming: async (params: any) => {
				upcomingInvoiceRetrievals.push(params)
				if (options?.upcomingInvoiceError) {
					throw options.upcomingInvoiceError
				}

				return {
					amount_due: options?.upcomingInvoice?.amountDue ?? 1000,
					currency: options?.upcomingInvoice?.currency ?? 'usd',
				}
			},
		},
		prices: {
			retrieve: async (priceId: string) => ({
				id: priceId,
				recurring: { usage_type: 'licensed' },
			}),
		},
		__test: {
			checkoutSessionRequestOptions,
			checkoutSessions,
			createdSubscriptions,
			subscriptionCancellations,
			promotionCodeLists,
			subscriptionLists,
			subscriptionItemUpdates,
			subscriptionUpdates,
			upcomingInvoiceRetrievals,
			operationLog,
		},
	} as unknown as Stripe
}

export function createStripeEvent(input: {
	eventId?: string
	type: Stripe.Event.Type
	customer?: string | { id: string } | null
	extraObject?: Record<string, unknown>
}): Stripe.Event {
	const object: Record<string, unknown> = { ...(input.extraObject ?? {}) }

	if (input.customer !== undefined) {
		object.customer = input.customer
	}

	return {
		id: input.eventId ?? `evt_${input.type.replaceAll('.', '_')}`,
		object: 'event',
		type: input.type,
		data: { object },
	} as unknown as Stripe.Event
}
