import { describe, expect, test } from 'vitest'

import { organizationInsertSchema, organizationSelectSchema, organizationUpdateSchema } from './organizations'

const baseOrganization = {
	id: '019b049c-950d-7baa-b9a8-b9364599319b',
	created_at: 1n,
	updated_at: 1n,
	name: 'Test Org',
	workos_organization_id: 'org_test',
	has_received_trial: false,
	eula_accepted_by: null,
	eula_accepted_at: null,
}

describe('organization stripe customer schemas', () => {
	test('select schema accepts null and cus-prefixed Stripe customer IDs', () => {
		expect(organizationSelectSchema.safeParse({ ...baseOrganization, stripe_customer_id: null }).success).toBe(true)
		expect(organizationSelectSchema.safeParse({ ...baseOrganization, stripe_customer_id: 'cus_123' }).success).toBe(
			true,
		)
	})

	test('select schema rejects empty, whitespace, and non-customer Stripe IDs', () => {
		for (const stripe_customer_id of ['', '   ', 'customer_123', 'sub_123']) {
			expect(organizationSelectSchema.safeParse({ ...baseOrganization, stripe_customer_id }).success).toBe(false)
		}
	})

	test('insert and update schemas preserve omitted and nullable semantics', () => {
		expect(
			organizationInsertSchema.safeParse({ name: 'Test Org', workos_organization_id: 'org_test' }).success,
		).toBe(true)
		expect(
			organizationInsertSchema.safeParse({
				name: 'Test Org',
				workos_organization_id: 'org_test',
				stripe_customer_id: null,
			}).success,
		).toBe(true)
		expect(organizationUpdateSchema.safeParse({}).success).toBe(true)
		expect(organizationUpdateSchema.safeParse({ stripe_customer_id: null }).success).toBe(true)
		expect(organizationUpdateSchema.safeParse({ stripe_customer_id: 'cus_123' }).success).toBe(true)
		expect(organizationInsertSchema.safeParse({ stripe_customer_id: 'sub_123' }).success).toBe(false)
		expect(organizationUpdateSchema.safeParse({ stripe_customer_id: 'sub_123' }).success).toBe(false)
	})
})
