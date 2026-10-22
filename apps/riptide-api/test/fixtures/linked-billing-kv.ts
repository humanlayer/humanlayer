import { TestBillingKvService } from './billing-kv-runtime'

export type LinkedBillingFixture = {
	organizationId: string
	customerId: string
	kv: TestBillingKvService
	linkCustomerToOrg(): Promise<void>
}

export async function createLinkedBillingFixture(input?: {
	organizationId?: string
	customerId?: string
}): Promise<LinkedBillingFixture> {
	const organizationId = input?.organizationId ?? 'org_test'
	const customerId = input?.customerId ?? 'cus_test'
	const kv = new TestBillingKvService()

	return {
		organizationId,
		customerId,
		kv,
		async linkCustomerToOrg() {
			await kv.setOrgCustomerId(organizationId, customerId)
			await kv.setCustomerOrgId(customerId, organizationId)
		},
	}
}
