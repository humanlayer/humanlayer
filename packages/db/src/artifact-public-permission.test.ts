import { describe, expect, it } from 'vitest'

import { effectivePublicPermission } from './artifact-public-permission'

const allowed = { publicLinksAllowed: true }

describe('effectivePublicPermission', () => {
	it('treats a disabled compatibility bit as off', () => {
		expect(effectivePublicPermission({ share_enabled: false, public_permission: 'comment' }, allowed)).toBe('off')
	})

	it('treats legacy enabled rows as view', () => {
		expect(effectivePublicPermission({ share_enabled: true, public_permission: 'off' }, allowed)).toBe('view')
	})

	it('preserves aligned comment permission', () => {
		expect(effectivePublicPermission({ share_enabled: true, public_permission: 'comment' }, allowed)).toBe(
			'comment',
		)
	})

	it('treats every row as off when the org disallows public links', () => {
		const disallowed = { publicLinksAllowed: false }
		expect(effectivePublicPermission({ share_enabled: true, public_permission: 'view' }, disallowed)).toBe('off')
		expect(effectivePublicPermission({ share_enabled: true, public_permission: 'comment' }, disallowed)).toBe('off')
	})
})
