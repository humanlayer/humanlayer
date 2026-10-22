import { describe, expect, test } from 'vitest'

import {
	isSettingsSectionVisible,
	SETTINGS_SECTION_GROUPS,
	SETTINGS_SECTION_LABELS,
	SETTINGS_SECTION_PATHS,
	shouldSuppressSettingsSectionTitle,
} from './settings-sections'

describe('administration settings registration', () => {
	test('registers access requests and users in Administration', () => {
		expect(SETTINGS_SECTION_PATHS['access-requests']).toBe('/settings/access-requests')
		expect(SETTINGS_SECTION_LABELS['access-requests']).toBe('Access requests')
		expect(SETTINGS_SECTION_PATHS.users).toBe('/settings/users')
		expect(SETTINGS_SECTION_LABELS.users).toBe('Users')
		expect(SETTINGS_SECTION_GROUPS).toContainEqual({
			label: 'Administration',
			sections: ['access-requests', 'users'],
		})
		expect(shouldSuppressSettingsSectionTitle('access-requests')).toBe(true)
		expect(shouldSuppressSettingsSectionTitle('general')).toBe(false)
	})

	test('is visible only to organization admins', () => {
		const base = { billingPreviewEnabled: false, projectsV2Enabled: false }
		expect(isSettingsSectionVisible('access-requests', { ...base, roles: ['admin'] })).toBe(true)
		expect(isSettingsSectionVisible('access-requests', { ...base, roles: ['member'] })).toBe(false)
		expect(isSettingsSectionVisible('access-requests', { ...base, roles: undefined })).toBe(false)
		expect(isSettingsSectionVisible('users', { ...base, roles: ['admin'] })).toBe(true)
		expect(isSettingsSectionVisible('users', { ...base, roles: ['member'] })).toBe(false)
	})
})
