import { call } from '@orpc/server'
import { describe, expect, test } from 'vitest'

import { listActiveOrgMembersProcedure, listOrgMembersProcedure } from '../../src/orpc/api/org/members-list'
import { createMockApiContext, StatefulMockWorkosService } from '../mocks'

describe('organization member lists', () => {
	test('keeps the existing list unchanged and filters the active list by organization membership', async () => {
		const workos = new StatefulMockWorkosService()
		workos.addOrganization({ id: 'org-current', name: 'Current organization' })
		workos.addOrganization({ id: 'org-other', name: 'Other organization' })

		for (const [id, email] of [
			['user-active', 'active@example.com'],
			['user-inactive', 'inactive@example.com'],
			['user-pending', 'pending@example.com'],
			['user-other-org', 'other@example.com'],
		] as const) {
			workos.addUser({ id, email })
		}

		workos.addMembership({ userId: 'user-active', organizationId: 'org-current', status: 'active' })
		workos.addMembership({ userId: 'user-inactive', organizationId: 'org-current', status: 'inactive' })
		workos.addMembership({ userId: 'user-pending', organizationId: 'org-current', status: 'pending' })
		workos.addMembership({ userId: 'user-other-org', organizationId: 'org-other', status: 'active' })

		const context = createMockApiContext({
			auth: { workosOrganizationId: 'org-current' },
			services: { workos },
		})

		const [allResult, activeResult] = await Promise.all([
			call(listOrgMembersProcedure, {}, { context }),
			call(listActiveOrgMembersProcedure, {}, { context }),
		])

		expect(allResult.members.map((member) => member.id)).toEqual(['user-active', 'user-inactive', 'user-pending'])
		expect(activeResult.members.map((member) => member.id)).toEqual(['user-active'])
	})
})
