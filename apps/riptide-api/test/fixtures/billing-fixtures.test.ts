import { describe, expect, test } from 'vitest'

import { createBillingLifecycleFixture } from './billing-lifecycle'
import { createLinkedBillingFixture } from './linked-billing-kv'

describe('billing fixtures', () => {
	test('creates linked fixture and writes bidirectional org/customer mapping', async () => {
		const fixture = await createLinkedBillingFixture({
			organizationId: 'org_fixture',
			customerId: 'cus_fixture',
		})

		await fixture.linkCustomerToOrg()

		expect(await fixture.kv.getOrgCustomerId('org_fixture')).toBe('cus_fixture')
		expect(await fixture.kv.getCustomerOrgId('cus_fixture')).toBe('org_fixture')
	})

	test('seeds lifecycle cache with defaults and overrides', async () => {
		const fixture = await createBillingLifecycleFixture({
			organizationId: 'org_lifecycle',
			customerId: 'cus_lifecycle',
		})

		await fixture.linkCustomerToOrg()
		const seeded = await fixture.seedCache({ status: 'active', hasPaidInvoice: true })

		expect(seeded.customerId).toBe('cus_lifecycle')
		expect(seeded.organizationId).toBe('org_lifecycle')
		expect(seeded.status).toBe('active')
		expect(seeded.hasPaidInvoice).toBe(true)

		expect(await fixture.kv.getSubscriptionCache('cus_lifecycle')).toMatchObject({
			customerId: 'cus_lifecycle',
			organizationId: 'org_lifecycle',
			status: 'active',
			hasPaidInvoice: true,
		})
	})
})
