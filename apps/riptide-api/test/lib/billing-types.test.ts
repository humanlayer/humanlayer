import { stripeBillingKeys } from '@humanlayer/billing/keys'
import { describe, expect, test } from 'vitest'

describe('stripeBillingKeys', () => {
	test('builds canonical key names for phase 3 billing cache', () => {
		expect(stripeBillingKeys.orgCustomer('org_123')).toBe('stripe:org:org_123')
		expect(stripeBillingKeys.customerOrg('cus_123')).toBe('stripe:customer:cus_123:org')
		expect(stripeBillingKeys.customerCache('cus_123')).toBe('stripe:customer:cus_123')
	})
})
