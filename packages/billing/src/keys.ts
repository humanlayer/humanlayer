export const stripeBillingKeys = {
	orgCustomer: (organizationId: string) => `stripe:org:${organizationId}`,
	customerCache: (customerId: string) => `stripe:customer:${customerId}`,
	customerOrg: (customerId: string) => `stripe:customer:${customerId}:org`,
}
