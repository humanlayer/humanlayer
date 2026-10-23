import { describe, expect, test } from 'vitest'

import { getSessionHostRegistrationIdentity } from '@/lib/session-host-identity'

describe('getSessionHostRegistrationIdentity', () => {
	test('uses the session creator as the daemon owner instead of the task resource owner', () => {
		const identity = getSessionHostRegistrationIdentity({
			host_id: 'shared-host',
			organization_id: 'organization-1',
			created_by: 'kyle',
		})

		expect(identity).toEqual({ hostId: 'shared-host', organizationId: 'organization-1', userId: 'kyle' })
	})

	test('returns undefined until every composite identity field is available', () => {
		expect(
			getSessionHostRegistrationIdentity({ host_id: 'host-1', organization_id: null, created_by: 'kyle' }),
		).toBe(undefined)
	})
})
