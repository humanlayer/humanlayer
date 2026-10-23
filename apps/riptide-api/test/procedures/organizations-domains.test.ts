import { call } from '@orpc/server'
import { describe, expect, test } from 'vitest'

import { addDomainProcedure } from '../../src/orpc/api/auth/admin/organizations-add-domain'
import { removeDomainProcedure } from '../../src/orpc/api/auth/admin/organizations-remove-domain'
import { createMockApiContext, StatefulMockWorkosService } from '../mocks'

const workosOrganizationId = 'org_domains_test'

function createDomainContext(workos: StatefulMockWorkosService) {
	return createMockApiContext({
		auth: { workosOrganizationId, role: 'admin' },
		services: { workos },
	})
}

describe('organization domain administration', () => {
	test('adds a domain without rewriting existing provider-managed domain states', async () => {
		const workos = new StatefulMockWorkosService()
		workos.addOrganization({
			id: workosOrganizationId,
			name: 'Domain Test Organization',
			domains: [{ id: 'org_domain_failed', domain: 'failed.example.com', state: 'failed' }],
		})

		const result = await call(
			addDomainProcedure,
			{ domain: 'new.example.com' },
			{ context: createDomainContext(workos) },
		)

		expect(result).toEqual({ success: true })
		expect(workos._organizations.get(workosOrganizationId)?.domains).toEqual([
			{ id: 'org_domain_failed', domain: 'failed.example.com', state: 'failed' },
			expect.objectContaining({ domain: 'new.example.com', state: 'pending' }),
		])
	})

	test('removes only the requested organization domain', async () => {
		const workos = new StatefulMockWorkosService()
		workos.addOrganization({
			id: workosOrganizationId,
			name: 'Domain Test Organization',
			domains: [
				{ id: 'org_domain_legacy', domain: 'legacy.example.com', state: 'legacy_verified' },
				{ id: 'org_domain_pending', domain: 'remove.example.com', state: 'pending' },
			],
		})

		const result = await call(
			removeDomainProcedure,
			{ domain: 'remove.example.com' },
			{ context: createDomainContext(workos) },
		)

		expect(result).toEqual({ success: true })
		expect(workos._organizations.get(workosOrganizationId)?.domains).toEqual([
			{ id: 'org_domain_legacy', domain: 'legacy.example.com', state: 'legacy_verified' },
		])
	})
})
