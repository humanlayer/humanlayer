import { describe, expect, it } from 'vitest'

import { parseWorkOsAccessTokenClaims } from '../src/effect/workos-access-token'

const requiredClaims = {
	iss: 'https://api.workos.com',
	sub: 'user_01HBEQKA6K4QJAS93VPE39W1JT',
	sid: 'session_01HQSXZGF8FHF7A9ZZFCW4387R',
}

describe('WorkOsAccessTokenClaims', () => {
	it('parses a session token without an organization or optional authorization claims', () => {
		expect(parseWorkOsAccessTokenClaims(requiredClaims)).toEqual(requiredClaims)
	})

	it('parses the optional organization and authorization claims', () => {
		expect(
			parseWorkOsAccessTokenClaims({
				...requiredClaims,
				act: { sub: 'admin@example.com' },
				org_id: 'org_01HRDMC6CM357W30QMHMQ96Q0S',
				internal_org_id: 'b4955038-8ee5-46d9-9bc4-f72e9cc9cbd8',
				role: 'member',
				roles: ['member'],
				permissions: ['posts:read'],
				entitlements: ['audit-logs'],
				feature_flags: ['advanced-analytics'],
			}),
		).toMatchObject({
			org_id: 'org_01HRDMC6CM357W30QMHMQ96Q0S',
			roles: ['member'],
			permissions: ['posts:read'],
		})
	})

	it('rejects a token without the session identity claims Riptide consumes', () => {
		expect(() => parseWorkOsAccessTokenClaims({ iss: requiredClaims.iss, sid: requiredClaims.sid })).toThrow()
		expect(() => parseWorkOsAccessTokenClaims({ ...requiredClaims, permissions: ['posts:read', 1] })).toThrow()
	})
})
