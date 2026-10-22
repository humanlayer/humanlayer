import type { ReadableStripeSubscriptionCache, StripeSubscriptionCache } from '@humanlayer/billing/billing-kv'
import { BillingKvService } from '@humanlayer/billing/billing-kv'
import { RedisService } from '@humanlayer/billing/redis'
import { Effect, Layer, ManagedRuntime } from 'effect'

import type { BillingKvRuntime } from '../../src/effects/app-runtime'

export class TestBillingKvService {
	private readonly organizationCustomers = new Map<string, string>()
	private readonly customerOrganizations = new Map<string, string>()
	private readonly subscriptionCaches = new Map<string, ReadableStripeSubscriptionCache>()

	async getOrgCustomerId(organizationId: string): Promise<string | null> {
		return this.organizationCustomers.get(organizationId) ?? null
	}

	async setOrgCustomerId(organizationId: string, customerId: string): Promise<void> {
		this.organizationCustomers.set(organizationId, customerId)
	}

	async getCustomerOrgId(customerId: string): Promise<string | null> {
		return this.customerOrganizations.get(customerId) ?? null
	}

	async setCustomerOrgId(customerId: string, organizationId: string): Promise<void> {
		this.customerOrganizations.set(customerId, organizationId)
	}

	async getSubscriptionCache(customerId: string): Promise<ReadableStripeSubscriptionCache | null> {
		return this.subscriptionCaches.get(customerId) ?? null
	}

	async setSubscriptionCache(customerId: string, cache: StripeSubscriptionCache): Promise<void> {
		this.subscriptionCaches.set(customerId, cache)
	}
}

export function billingKvLayerFromTestService(service: TestBillingKvService) {
	return Layer.succeed(BillingKvService, {
		getOrgCustomerId: ({ organizationId }) => Effect.promise(() => service.getOrgCustomerId(organizationId)),
		setOrgCustomerId: ({ organizationId, customerId }) =>
			Effect.promise(() => service.setOrgCustomerId(organizationId, customerId)),
		getCustomerOrgId: ({ customerId }) => Effect.promise(() => service.getCustomerOrgId(customerId)),
		setCustomerOrgId: ({ customerId, organizationId }) =>
			Effect.promise(() => service.setCustomerOrgId(customerId, organizationId)),
		getSubscriptionCache: ({ customerId }) => Effect.promise(() => service.getSubscriptionCache(customerId)),
		setSubscriptionCache: ({ customerId, cache }) =>
			Effect.promise(() => service.setSubscriptionCache(customerId, cache)),
	})
}

export function makeTestBillingKvRuntime(service = new TestBillingKvService()): BillingKvRuntime {
	return ManagedRuntime.make(
		Layer.mergeAll(
			billingKvLayerFromTestService(service),
			Layer.succeed(RedisService, { send: () => Effect.die('Redis is not used by TestBillingKvService') }),
		),
	)
}
